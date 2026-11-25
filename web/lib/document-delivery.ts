// Ρητή εξωτερική αποστολή: tenant gate, συσχετισμένοι παραλήπτες, claim πριν από I/O και ποτέ αυτόματο replay ασαφούς αποτελέσματος.
import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { writeAudit } from "./audit";
import { settings } from "./config";
import { db } from "./db";
import { generatePdfAttachment } from "./documents/output";
import type { LoadedDocument } from "./documents/model";
import { esc, type Mail } from "./mail/templates";
import { mailConfigured, maskEmail, redactDeliveryText, sendMailDetailed, type MailAttachment } from "./mail/send";
import { scheduleIcs, scheduleShifts } from "./schedule-export";
import { assertGlobalStockScope, type StockContext } from "./stock-scope";

export const DELIVERY_CHANNELS = ["email", "viber"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type DeliveryStatus = "PREPARED" | "DISABLED" | "SKIPPED" | "SENDING" | "SENT" | "FAILED" | "UNCONFIRMED" | "ABORTED";
export type DeliveryResult = { status: DeliveryStatus | "DUPLICATE"; deliveryStatus: DeliveryStatus; detail: string };
export type RecipientKind = "party" | "employee";
export type DeliveryRecipient = {
  id: string;
  key: string;
  kind: RecipientKind;
  name: string;
  email: string | null;
  viberReceiver: string | null;
};
export type DeliveryOrganization = {
  id: string;
  name: string;
  slug: string | null;
  contactEmail: string | null;
  emailFromName: string | null;
  externalSendingEnabled: boolean;
};

export class DocumentDeliveryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DocumentDeliveryError";
    this.code = code;
    this.status = status;
  }
}

export function isDeliveryChannel(value: unknown): value is DeliveryChannel {
  return typeof value === "string" && (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

function validEmail(value: string | null | undefined) {
  const clean = value?.trim().toLowerCase() ?? "";
  return clean.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean : null;
}

/** Bot send_message δέχεται subscriber ID. Ένα απλό τηλέφωνο απορρίπτεται ρητά αντί να παρουσιαστεί ως Viber delivery. */
export function validViberReceiver(value: string | null | undefined) {
  const clean = value?.trim() ?? "";
  if (clean.length < 4 || clean.length > 256 || !/^[\x21-\x7e]+$/.test(clean) || /^\+?\d{6,15}$/.test(clean)) return null;
  return clean;
}

export function maskDestination(channel: DeliveryChannel, value: string) {
  return channel === "email" ? maskEmail(value) : `Viber ••••${value.slice(-4)}`;
}

const recipientKey = (kind: RecipientKind, id: string) => `${kind}:${id}`;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
const auditScope = (loaded: LoadedDocument) => ({
  storeId: loaded.scope?.storeId,
  warehouseId: loaded.scope?.warehouseId ?? loaded.scope?.warehouseIds?.[0],
});
const auditMetadata = (channel: DeliveryChannel, recipient: DeliveryRecipient, extra: Record<string, string | boolean> = {}): Prisma.InputJsonValue => ({
  channel,
  provider: channel === "email" ? "mailgun" : "viber",
  recipientKind: recipient.kind,
  recipientId: recipient.id,
  recipientMasked: maskDestination(channel, channel === "email" ? recipient.email ?? "χωρίς-email" : recipient.viberReceiver ?? "χωρίς-subscriber-id"),
  ...extra,
});

async function relatedParty(ctx: StockContext, loaded: LoadedDocument): Promise<{ id: string; role: "supplier" | "customer" } | null> {
  const { entityType, entityId } = loaded.model;
  if (entityType === "purchase_order") {
    const order = await db.purchaseOrder.findFirst({ where: { id: entityId, orgId: ctx.orgId }, select: { supplierId: true } });
    return order ? { id: order.supplierId, role: "supplier" } : null;
  }
  if (entityType === "wholesale_quote") {
    const quote = await db.wholesaleQuote.findFirst({ where: { id: entityId, orgId: ctx.orgId }, select: { customerId: true } });
    return quote ? { id: quote.customerId, role: "customer" } : null;
  }
  if (entityType === "sales_document") {
    const document = await db.salesDocument.findFirst({ where: { id: entityId, orgId: ctx.orgId }, select: { customerId: true } });
    return document ? { id: document.customerId, role: "customer" } : null;
  }
  return null;
}

async function partyRecipient(ctx: StockContext, related: { id: string; role: "supplier" | "customer" }): Promise<DeliveryRecipient | null> {
  const party = await db.party.findFirst({
    where: { id: related.id, orgId: ctx.orgId, active: true, roles: { has: related.role } },
    select: { id: true, name: true, email: true },
  });
  if (!party) return null;
  // PartyChannel δεν έχει orgId· το relation filter διατηρεί τον tenant έλεγχο και στο δεύτερο query.
  const viber = await db.partyChannel.findFirst({
    where: { partyId: party.id, kind: "viber", party: { orgId: ctx.orgId, active: true } },
    select: { value: true },
  });
  return { id: party.id, key: recipientKey("party", party.id), kind: "party", name: party.name, email: validEmail(party.email), viberReceiver: validViberReceiver(viber?.value) };
}

function scheduleEmployeeIds(loaded: LoadedDocument) {
  if (loaded.model.entityType !== "schedule_publication" || !loaded.schedule) return [];
  return [...new Set(scheduleShifts(loaded.schedule.snapshot).map((shift) => shift.employeeId))].slice(0, 300);
}

async function scheduleRecipient(ctx: StockContext, loaded: LoadedDocument, employeeId: string): Promise<DeliveryRecipient | null> {
  if (!scheduleEmployeeIds(loaded).includes(employeeId)) return null;
  const storeId = loaded.scope?.storeId;
  const employee = await db.employee.findFirst({
    where: {
      id: employeeId, orgId: ctx.orgId, active: true,
      // Ο εργαζόμενος πρέπει να ανήκει στο δημοσιευμένο store ή να μην έχει μετακινηθεί ρητά σε άλλο.
      ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : {}),
    },
    select: { id: true, name: true, email: true },
  });
  if (!employee) return null;
  // Το Employee έχει μόνο phone, όχι Viber subscriber ID. Δεν γίνεται λανθασμένη αντιστοίχιση τηλεφώνου με receiver.
  return { id: employee.id, key: recipientKey("employee", employee.id), kind: "employee", name: employee.name, email: validEmail(employee.email), viberReceiver: null };
}

export async function resolveRecipient(ctx: StockContext, loaded: LoadedDocument, recipientId: string): Promise<DeliveryRecipient> {
  if (!recipientId || recipientId.length > 120) throw new DocumentDeliveryError("INVALID_RECIPIENT", "Άκυρος παραλήπτης");
  let recipient: DeliveryRecipient | null;
  if (loaded.model.entityType === "schedule_publication") recipient = await scheduleRecipient(ctx, loaded, recipientId);
  else {
    const related = await relatedParty(ctx, loaded);
    recipient = related?.id === recipientId ? await partyRecipient(ctx, related) : null;
  }
  if (!recipient) throw new DocumentDeliveryError("INVALID_RECIPIENT", "Ο παραλήπτης δεν συσχετίζεται με αυτό το έγγραφο ή δεν είναι ενεργός", 403);
  return recipient;
}

async function loadOrganization(ctx: StockContext): Promise<DeliveryOrganization> {
  const org = await db.organization.findFirst({
    where: { id: ctx.orgId },
    select: { id: true, name: true, slug: true, contactEmail: true, emailFromName: true, externalSendingEnabled: true },
  });
  if (!org) throw new DocumentDeliveryError("NOT_FOUND", "Η επιχείρηση δεν βρέθηκε", 404);
  return org;
}

export async function listDocumentRecipients(ctx: StockContext, loaded: LoadedDocument) {
  const org = await loadOrganization(ctx);
  let recipients: DeliveryRecipient[] = [];
  if (loaded.model.entityType === "schedule_publication") {
    const ids = scheduleEmployeeIds(loaded);
    const storeId = loaded.scope?.storeId;
    const employees = ids.length ? await db.employee.findMany({
      where: { orgId: ctx.orgId, id: { in: ids }, active: true, ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : {}) },
      select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
    }) : [];
    recipients = employees.map((employee) => ({ id: employee.id, key: recipientKey("employee", employee.id), kind: "employee", name: employee.name, email: validEmail(employee.email), viberReceiver: null }));
  } else {
    const related = await relatedParty(ctx, loaded);
    const party = related ? await partyRecipient(ctx, related) : null;
    if (party) recipients = [party];
  }
  return {
    externalSendingEnabled: org.externalSendingEnabled,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email ? maskEmail(recipient.email) : null,
      viber: recipient.viberReceiver ? maskDestination("viber", recipient.viberReceiver) : null,
      viberReason: recipient.kind === "employee" ? "Το Viber Bot API απαιτεί subscriber ID· δεν υπάρχει τέτοιο πεδίο στον εργαζόμενο." : "Απαιτείται καταχωρισμένο Viber subscriber ID στο κανάλι του συναλλασσομένου.",
    })),
  };
}

type Receipt = { id: string; status: DeliveryStatus; createdAt: Date };
type DeliveryKey = { orgId: string; entityType: string; entityId: string; channel: DeliveryChannel; recipient: string };
type Blocked = { status: "DISABLED" | "SKIPPED"; detail: string };
type ClaimResult = { outcome: "CLAIMED"; id: string } | { outcome: "BLOCKED"; result: DeliveryResult } | { outcome: "REPLAY"; result: DeliveryResult };

const keyOf = (ctx: StockContext, loaded: LoadedDocument, channel: DeliveryChannel, recipient: DeliveryRecipient): DeliveryKey => ({
  orgId: ctx.orgId, entityType: loaded.model.entityType, entityId: loaded.model.entityId, channel, recipient: recipient.key,
});
const uniqueWhere = (key: DeliveryKey) => ({ orgId_entityType_entityId_channel_recipient: key });

function replayResult(receipt: Receipt): DeliveryResult {
  const detail = receipt.status === "SENT" ? "Έχει ήδη καταγραφεί πραγματική αποστολή· δεν στάλθηκε ξανά."
    : receipt.status === "UNCONFIRMED" ? "Η προηγούμενη απόκριση είναι ασαφής· δεν έγινε replay γιατί μπορεί να έχει σταλεί."
      : "Υπάρχει ατελές ή ενεργό αίτημα· δεν πραγματοποιήθηκε δεύτερη αποστολή.";
  return { status: "DUPLICATE", deliveryStatus: receipt.status, detail };
}

/** Atomic claim με το υπάρχον σύνθετο unique. SENT/UNCONFIRMED/SENDING δεν ξανανοίγουν ποτέ provider κλήση. */
async function claimReceipt(ctx: StockContext, loaded: LoadedDocument, channel: DeliveryChannel, recipient: DeliveryRecipient, blocked: Blocked | null): Promise<ClaimResult> {
  const key = keyOf(ctx, loaded, channel, recipient);
  const initialDetail = `Προετοιμασία ${channel} προς ${maskDestination(channel, channel === "email" ? recipient.email ?? "χωρίς-email" : recipient.viberReceiver ?? "χωρίς-subscriber-id")}· δεν έγινε αποστολή`;
  await db.documentDelivery.createMany({
    data: [{ ...key, status: "PREPARED", detail: initialDetail, createdByName: ctx.userName }],
    skipDuplicates: true,
  });
  return db.$transaction(async (tx) => {
    let current = await tx.documentDelivery.findUnique({ where: uniqueWhere(key), select: { id: true, status: true, createdAt: true } });
    if (!current) throw new Error("Το delivery receipt δεν δημιουργήθηκε");
    if (["SENT", "UNCONFIRMED", "SENDING"].includes(current.status)) {
      await writeAudit(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "document.delivery.replay", entityType: loaded.model.entityType, entityId: loaded.model.entityId, ...auditScope(loaded), metadata: auditMetadata(channel, recipient, { replayBlocked: true, receiptStatus: current.status }) });
      return { outcome: "REPLAY", result: replayResult(current as Receipt) };
    }
    if (blocked) {
      await tx.documentDelivery.updateMany({
        where: { id: current.id, status: { notIn: ["SENT", "UNCONFIRMED", "SENDING"] } },
        data: { status: blocked.status, detail: blocked.detail, createdByName: ctx.userName, createdAt: new Date() },
      });
      await writeAudit(tx, { orgId: ctx.orgId, actor: actor(ctx), action: blocked.status === "DISABLED" ? "document.delivery.disabled" : "document.delivery.skipped", entityType: loaded.model.entityType, entityId: loaded.model.entityId, ...auditScope(loaded), metadata: auditMetadata(channel, recipient, { blocked: true }) });
      return { outcome: "BLOCKED", result: { status: blocked.status, deliveryStatus: blocked.status, detail: blocked.detail } };
    }
    const claimed = await tx.documentDelivery.updateMany({
      where: { id: current.id, status: { notIn: ["SENT", "UNCONFIRMED", "SENDING"] } },
      data: { status: "SENDING", detail: "Ξεκίνησε μία ελεγχόμενη provider κλήση· δεν υπάρχει ακόμη απάντηση", createdByName: ctx.userName, createdAt: new Date() },
    });
    if (!claimed.count) {
      current = await tx.documentDelivery.findUnique({ where: uniqueWhere(key), select: { id: true, status: true, createdAt: true } });
      return { outcome: "REPLAY", result: replayResult(current as Receipt) };
    }
    await writeAudit(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "document.delivery.requested", entityType: loaded.model.entityType, entityId: loaded.model.entityId, ...auditScope(loaded), metadata: auditMetadata(channel, recipient) });
    return { outcome: "CLAIMED", id: current.id };
  });
}

const completionAction: Record<string, string> = {
  SENT: "document.delivery.sent", FAILED: "document.delivery.failed", UNCONFIRMED: "document.delivery.unconfirmed",
  SKIPPED: "document.delivery.skipped", ABORTED: "document.delivery.aborted",
};

async function completeReceipt(ctx: StockContext, loaded: LoadedDocument, channel: DeliveryChannel, recipient: DeliveryRecipient, id: string, status: "SENT" | "FAILED" | "UNCONFIRMED" | "SKIPPED" | "ABORTED", detail: string): Promise<DeliveryResult> {
  await db.$transaction(async (tx) => {
    const updated = await tx.documentDelivery.updateMany({ where: { id, status: "SENDING" }, data: { status, detail, createdByName: ctx.userName, createdAt: new Date() } });
    if (!updated.count) throw new Error("Το delivery claim δεν είναι πλέον ενεργό");
    await writeAudit(tx, { orgId: ctx.orgId, actor: actor(ctx), action: completionAction[status]!, entityType: loaded.model.entityType, entityId: loaded.model.entityId, ...auditScope(loaded), metadata: auditMetadata(channel, recipient, { providerResponse: status === "SENT" || status === "FAILED" }) });
  });
  return { status, deliveryStatus: status, detail };
}

export const VIBER_SEND_MESSAGE_URL = "https://chatapi.viber.com/pa/send_message";
export const VIBER_PROVIDER_TIMEOUT_MS = 10_000;
export type ViberProviderResult = { status: "SENT" | "FAILED" | "UNCONFIRMED"; detail: string };

/** Επίσημο REST Bot API: X-Viber-Auth-Token, receiver=subscriber ID και SENT μόνο με HTTP 2xx + status:0 + message_token. */
export async function sendViberText(input: { token: string; senderName: string; receiver: string; text: string; trackingData: string }, fetchImpl: typeof fetch = fetch): Promise<ViberProviderResult> {
  try {
    const response = await fetchImpl(VIBER_SEND_MESSAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Viber-Auth-Token": input.token },
      body: JSON.stringify({ receiver: input.receiver, min_api_version: 1, sender: { name: input.senderName.replace(/[\r\n]/g, " ").trim().slice(0, 28) || "Gelato System" }, tracking_data: input.trackingData.slice(0, 4096), type: "text", text: input.text.slice(0, 7000) }),
      cache: "no-store",
      signal: AbortSignal.timeout(VIBER_PROVIDER_TIMEOUT_MS),
    });
    const raw = (await response.text()).slice(0, 16_384);
    if (!response.ok) return { status: "FAILED", detail: redactDeliveryText(`Viber HTTP ${response.status}: ${raw}`, [input.token]) };
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return { status: "UNCONFIRMED", detail: "Viber επέστρεψε μη αναγνώσιμη επιτυχή απάντηση· η αποστολή δεν επιβεβαιώθηκε" }; }
    const result = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const token = result.message_token;
    if (result.status === 0 && (typeof token === "number" || typeof token === "string")) return { status: "SENT", detail: "Viber API status 0 και message_token· το αίτημα έγινε αποδεκτό" };
    if (typeof result.status === "number" && result.status !== 0) return { status: "FAILED", detail: redactDeliveryText(`Viber status ${result.status}: ${String(result.status_message ?? "απορρίφθηκε")}`, [input.token]) };
    return { status: "UNCONFIRMED", detail: "Viber απάντησε χωρίς τεκμηριωμένο status 0/message_token· η αποστολή δεν επιβεβαιώθηκε" };
  } catch (error) {
    return { status: "UNCONFIRMED", detail: `Χωρίς οριστική Viber απόκριση (timeout/network)· ${redactDeliveryText(error instanceof Error ? error.message : error, [input.token])}` };
  }
}

async function viberConfig() {
  const config = await settings("VIBER_AUTH_TOKEN", "VIBER_SENDER_NAME");
  return config.VIBER_AUTH_TOKEN ? { token: config.VIBER_AUTH_TOKEN, senderName: config.VIBER_SENDER_NAME || "Gelato System" } : null;
}

function documentMail(loaded: LoadedDocument, recipient: DeliveryRecipient): Mail {
  const subject = `${loaded.model.title} — ${loaded.model.brand.name}`;
  const text = `Γεια σας ${recipient.name},\n\nΣας επισυνάπτεται το έγγραφο «${loaded.model.title}» από ${loaded.model.brand.name}.\n\nΤο μήνυμα στάλθηκε μετά από ρητή ενέργεια χρήστη.`;
  const html = `<p>Γεια σας ${esc(recipient.name)},</p><p>Σας επισυνάπτεται το έγγραφο <strong>${esc(loaded.model.title)}</strong> από ${esc(loaded.model.brand.name)}.</p><p>Το μήνυμα στάλθηκε μετά από ρητή ενέργεια χρήστη.</p>`;
  return { subject, text, html };
}

export async function prepareEmail(ctx: StockContext, loaded: LoadedDocument, recipient: DeliveryRecipient): Promise<{ mail: Mail; attachments: MailAttachment[]; template: string }> {
  if (loaded.model.entityType === "schedule_publication") {
    if (!loaded.schedule) throw new Error("Λείπει το snapshot προγράμματος");
    const shifts = scheduleShifts(loaded.schedule.snapshot).filter((shift) => shift.employeeId === recipient.id);
    if (!shifts.length) throw new Error("Ο εργαζόμενος δεν έχει βάρδιες στο snapshot");
    const period = `${loaded.schedule.fromAt.toLocaleDateString("el-GR", { timeZone: "Europe/Athens" })} — ${loaded.schedule.toAt.toLocaleDateString("el-GR", { timeZone: "Europe/Athens" })}`;
    const subject = `${loaded.model.title} — ${period}`;
    const text = `Γεια σου ${recipient.name},\n\nΔημοσιεύθηκε το πρόγραμμα βαρδιών σου (${period}), έκδοση ${loaded.schedule.version}.\nΕπισυνάπτεται ημερολόγιο ICS μόνο με τις δικές σου βάρδιες.`;
    const mail = { subject, text, html: `<p>Γεια σου ${esc(recipient.name)},</p><p>Δημοσιεύθηκε το πρόγραμμα βαρδιών σου (${esc(period)}), έκδοση ${loaded.schedule!.version}.</p><p>Επισυνάπτεται ημερολόγιο ICS <strong>μόνο με τις δικές σου βάρδιες</strong>.</p>` };
    const ics = scheduleIcs({ publicationId: loaded.model.entityId, version: loaded.schedule.version, title: loaded.model.title, shifts });
    return { mail, template: "staff.schedule.notification", attachments: [{ filename: `schedule-v${loaded.schedule.version}.ics`, contentType: "text/calendar; charset=utf-8", data: new TextEncoder().encode(ics) }] };
  }
  return { mail: documentMail(loaded, recipient), template: "document.delivery", attachments: [await generatePdfAttachment(ctx, loaded.model, loaded.scope)] };
}

function viberNotification(loaded: LoadedDocument, recipient: DeliveryRecipient) {
  if (loaded.model.entityType === "schedule_publication" && loaded.schedule) return `Γεια σου ${recipient.name}. Δημοσιεύθηκε το «${loaded.model.title}». Άνοιξε το προσωπικό σου σύνδεσμο προγράμματος για τις βάρδιες σου.`;
  // Το ιδιωτικό PDF δεν γίνεται δημόσιο για χάρη του Viber file message. Στέλνεται μόνο σαφής text ειδοποίηση.
  return `Γεια σας ${recipient.name}. Δημιουργήθηκε το έγγραφο «${loaded.model.title}» από ${loaded.model.brand.name}. Αυτό είναι μήνυμα ειδοποίησης· το ιδιωτικό PDF δεν επισυνάπτεται.`;
}

export type DocumentDeliveryDeps = {
  loadOrganization: typeof loadOrganization;
  resolveRecipient: typeof resolveRecipient;
  claimReceipt: typeof claimReceipt;
  completeReceipt: typeof completeReceipt;
  prepareEmail: typeof prepareEmail;
  mailConfigured: typeof mailConfigured;
  viberConfig: typeof viberConfig;
  sendMailDetailed: typeof sendMailDetailed;
  sendViberText: typeof sendViberText;
};
const productionDeps: DocumentDeliveryDeps = { loadOrganization, resolveRecipient, claimReceipt, completeReceipt, prepareEmail, mailConfigured, viberConfig, sendMailDetailed, sendViberText };

export async function deliverDocument(ctx: StockContext, loaded: LoadedDocument, input: { channel: DeliveryChannel; recipientId: string; confirm: boolean }, deps: DocumentDeliveryDeps = productionDeps): Promise<DeliveryResult> {
  if (!input.confirm) throw new DocumentDeliveryError("CONFIRMATION_REQUIRED", "Η εξωτερική αποστολή απαιτεί ρητή επιβεβαίωση");
  if (!isDeliveryChannel(input.channel)) throw new DocumentDeliveryError("INVALID_CHANNEL", "Μη υποστηριζόμενο κανάλι αποστολής");
  const [org, recipient] = await Promise.all([deps.loadOrganization(ctx), deps.resolveRecipient(ctx, loaded, input.recipientId)]);
  let blocked: Blocked | null = null;
  let viber: Awaited<ReturnType<typeof viberConfig>> = null;
  if (!org.externalSendingEnabled) blocked = { status: "DISABLED", detail: "Η εξωτερική αποστολή είναι απενεργοποιημένη για την επιχείρηση" };
  else if (input.channel === "email" && !recipient.email) blocked = { status: "SKIPPED", detail: "Ο συσχετισμένος παραλήπτης δεν έχει έγκυρο email" };
  else if (input.channel === "viber" && !recipient.viberReceiver) blocked = { status: "DISABLED", detail: "Το Viber απαιτεί καταχωρισμένο subscriber ID· το τηλέφωνο δεν χρησιμοποιείται ως receiver" };
  else if (input.channel === "email" && !await deps.mailConfigured()) blocked = { status: "SKIPPED", detail: "Δεν έχει ρυθμιστεί Mailgun· δεν πραγματοποιήθηκε αποστολή" };
  else if (input.channel === "viber") {
    viber = await deps.viberConfig();
    if (!viber) blocked = { status: "SKIPPED", detail: "Δεν έχει ρυθμιστεί Viber Bot token· δεν πραγματοποιήθηκε αποστολή" };
  }

  const claim = await deps.claimReceipt(ctx, loaded, input.channel, recipient, blocked);
  if (claim.outcome !== "CLAIMED") return claim.result;
  let outcome: { status: "SENT" | "FAILED" | "UNCONFIRMED" | "SKIPPED"; detail: string };
  try {
    if (input.channel === "email") {
      const prepared = await deps.prepareEmail(ctx, loaded, recipient);
      const key = keyOf(ctx, loaded, input.channel, recipient);
      const dedupeKey = `document-delivery:${createHash("sha256").update(JSON.stringify(key)).digest("hex")}`;
      const provider = await deps.sendMailDetailed({ to: recipient.email!, mail: prepared.mail, template: prepared.template, org, attachments: prepared.attachments, dedupeKey, developmentEcho: false });
      const status = provider === "DUPLICATE" ? "UNCONFIRMED" : provider;
      const detail = status === "SENT" ? "Mailgun αποδεκτή HTTP απάντηση· καταγράφηκε SENT"
        : status === "FAILED" ? "Mailgun επέστρεψε σαφή αποτυχία HTTP· καταγράφηκε FAILED"
          : status === "SKIPPED" ? "Ο provider δεν ήταν πλέον διαθέσιμος· δεν καταγράφηκε αποστολή"
            : "Δεν επιβεβαιώθηκε η απάντηση Mailgun ή βρέθηκε παλιό dedupe· δεν θα γίνει αυτόματο replay";
      outcome = { status, detail };
    } else {
      const trackingData = createHash("sha256").update(JSON.stringify(keyOf(ctx, loaded, input.channel, recipient))).digest("hex");
      const provider = await deps.sendViberText({ token: viber!.token, senderName: viber!.senderName, receiver: recipient.viberReceiver!, text: viberNotification(loaded, recipient), trackingData });
      const detail = provider.status === "SENT" ? `${provider.detail}· text ειδοποίηση, όχι attachment PDF` : provider.detail;
      outcome = { status: provider.status, detail };
    }
  } catch {
    // Μόνο preparation/provider κλήση μπαίνει εδώ. Αποτυχία μετά το provider result δεν δημιουργεί δεύτερο completion.
    return deps.completeReceipt(ctx, loaded, input.channel, recipient, claim.id, "ABORTED", "Η προετοιμασία ή η κλήση διακόπηκε χωρίς τεκμηριωμένη provider απόκριση· δεν καταγράφηκε αποστολή");
  }
  return deps.completeReceipt(ctx, loaded, input.channel, recipient, claim.id, outcome.status, outcome.detail);
}

/** Ξεχωριστό από το company profile για να μην αλλάξει η finance ροή· απαιτεί καθολικό scope και γράφει audit μόνο σε αλλαγή. */
export async function setExternalSendingEnabled(ctx: StockContext, enabled: boolean) {
  assertGlobalStockScope(ctx);
  return db.$transaction(async (tx) => {
    const current = await tx.organization.findFirst({ where: { id: ctx.orgId }, select: { id: true, externalSendingEnabled: true } });
    if (!current) throw new DocumentDeliveryError("NOT_FOUND", "Η επιχείρηση δεν βρέθηκε", 404);
    if (current.externalSendingEnabled === enabled) return current;
    const updated = await tx.organization.update({ where: { id: current.id }, data: { externalSendingEnabled: enabled }, select: { id: true, externalSendingEnabled: true } });
    await writeAudit(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "document.delivery.configure", entityType: "organization", entityId: ctx.orgId, metadata: { externalSendingEnabled: enabled } });
    return updated;
  });
}
