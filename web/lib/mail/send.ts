// Αποστολή μέσω Mailgun. Κλειδί, τομέας και περιοχή ορίζονται στις Ρυθμίσεις της πλατφόρμας (lib/config.ts).
// Ένα επαληθευμένο domain για όλη την πλατφόρμα· κάθε πελάτης στέλνει ως <slug>@domain με δικό του όνομα και Reply-To.
import { setting, settings as readSettings } from "../config";
import { db } from "../db";
import type { Mail } from "./templates";

const mailgun = () => readSettings("MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_REGION");
export const mailConfigured = async () => { const m = await mailgun(); return Boolean(m.MAILGUN_API_KEY && m.MAILGUN_DOMAIN); };
export const mailDomain = async () => (await setting("MAILGUN_DOMAIN")) || null;
export const MAIL_PROVIDER_TIMEOUT_MS = 10_000;

/** Όνομα σε κεφαλίδα From: χωρίς εισαγωγικά και αλλαγές γραμμής (αλλιώς μπορεί να «σπάσει» η κεφαλίδα). */
const headerName = (v: string) => v.replace(/["\r\n<>]/g, "").trim();

export function maskEmail(value: string) {
  const [local = "", domain = ""] = value.toLowerCase().split("@");
  const [host = "", ...suffix] = domain.split(".");
  return `${local.slice(0, 1) || "•"}•••@${host.slice(0, 1) || "•"}•••${suffix.length ? `.${suffix.join(".")}` : ""}`;
}

/** Provider errors και audit δεν κρατούν credentials, πλήρη email, τηλέφωνα ή token-like τιμές. */
export function redactDeliveryText(value: unknown, secrets: readonly string[] = []) {
  let text = String(value ?? "").replace(/[\u0000\r\n]+/g, " ").slice(0, 800);
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join("[redacted]");
  text = text.replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi, "[redacted authorization]");
  text = text.replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, (email) => maskEmail(email));
  text = text.replace(/(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)/g, "[redacted phone]");
  text = text.replace(/\b[a-z0-9_+/=-]{20,}\b/gi, "[redacted token]");
  return text.slice(0, 300);
}

export async function platformSettings() {
  return (await db.platformSettings.findUnique({ where: { id: 1 } })) ?? { id: 1, brandName: "Gelato System", baseDomain: null, supportEmail: null, lastBackupCheckAt: null, lastRestoreDrillAt: null, legalVersion: null, termsUrl: null, privacyUrl: null };
}

/** Διεύθυνση της εφαρμογής για έναν πελάτη: ο υποτομέας του αν υπάρχει, αλλιώς η γενική (APP_URL). */
export async function appUrl(org?: { slug: string | null } | null) {
  const { baseDomain } = await platformSettings();
  return org?.slug && baseDomain ? `https://${org.slug}.${baseDomain}` : ((await setting("APP_URL")) || "http://localhost:3210");
}

type Sender = { id: string; name: string; slug: string | null; contactEmail: string | null; emailFromName: string | null };
export type MailAttachment = { filename: string; contentType: string; data: Uint8Array };
export type DetailedMailStatus = "SENT" | "FAILED" | "SKIPPED" | "DUPLICATE" | "UNCONFIRMED";
export type SendMailInput = {
  to: string;
  mail: Mail;
  template: string;
  org?: Sender | null;
  dedupeKey?: string;
  attachments?: readonly MailAttachment[];
  /** Το document delivery δεν τυπώνει περιεχόμενο/παραλήπτη στο development log. */
  developmentEcho?: boolean;
};

/**
 * Πραγματικό Mailgun αποτέλεσμα. SENT/FAILED σημαίνουν σαφή HTTP απάντηση· timeout/network/abort μένει UNCONFIRMED,
 * ώστε ένας καλών το provider να μην το παρουσιάζει ως αποδεδειγμένη αποτυχία ή να το επαναλαμβάνει τυφλά.
 */
export async function sendMailDetailed(input: SendMailInput, fetchImpl: typeof fetch = fetch): Promise<DetailedMailStatus> {
  const { to, mail, template, org } = input;
  if (input.dedupeKey && (await db.emailLog.findUnique({ where: { dedupeKey: input.dedupeKey } }))) return "DUPLICATE";
  const settings = await platformSettings();
  let status: Exclude<DetailedMailStatus, "DUPLICATE"> = "SKIPPED";
  let error: string | undefined;

  const mg = await mailgun();
  if (mg.MAILGUN_API_KEY && mg.MAILGUN_DOMAIN) {
    const from = org ? `${headerName(org.emailFromName || org.name)} μέσω ${headerName(settings.brandName)} <${org.slug ?? "noreply"}@${mg.MAILGUN_DOMAIN}>` : `${headerName(settings.brandName)} <noreply@${mg.MAILGUN_DOMAIN}>`;
    const fields: Record<string, string> = { from, to, subject: mail.subject, html: mail.html, text: mail.text };
    const replyTo = org?.contactEmail ?? settings.supportEmail;
    if (replyTo) fields["h:Reply-To"] = replyTo;
    let body: URLSearchParams | FormData;
    if (input.attachments?.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      for (const attachment of input.attachments) {
        const bytes = Buffer.from(attachment.data);
        form.append("attachment", new Blob([bytes], { type: attachment.contentType }), attachment.filename);
      }
      body = form;
    } else body = new URLSearchParams(fields);
    try {
      const res = await fetchImpl(`https://${mg.MAILGUN_REGION === "us" ? "api.mailgun.net" : "api.eu.mailgun.net"}/v3/${mg.MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`api:${mg.MAILGUN_API_KEY}`).toString("base64")}` },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(MAIL_PROVIDER_TIMEOUT_MS),
      });
      status = res.ok ? "SENT" : "FAILED";
      if (!res.ok) error = redactDeliveryText(`HTTP ${res.status}: ${await res.text()}`, [mg.MAILGUN_API_KEY]);
    } catch (cause) {
      status = "UNCONFIRMED";
      error = `UNCONFIRMED: ${redactDeliveryText(cause instanceof Error ? cause.message : cause, [mg.MAILGUN_API_KEY])}`;
    }
  } else if (process.env.NODE_ENV !== "production" && input.developmentEcho !== false) {
    // Παλιές ροές: τοπική ανάπτυξη χωρίς Mailgun. Το document delivery το απενεργοποιεί ρητά.
    console.log(`\n[email που ΔΕΝ στάλθηκε → ${to}] ${mail.subject}\n${mail.text}\n`);
  }

  const logStatus = status === "UNCONFIRMED" ? "FAILED" : status;
  await db.emailLog.create({
    data: {
      orgId: org?.id, to, template, subject: mail.subject, status: logStatus, error,
      // Σε ασαφές αποτέλεσμα το dedupe εμποδίζει δεύτερη πραγματική προσπάθεια. SKIPPED/FAILED επιτρέπουν ρητό retry.
      dedupeKey: status === "SENT" || status === "UNCONFIRMED" ? input.dedupeKey : null,
    },
  }).catch(() => {});
  return status;
}

/** Συμβατό legacy API: οι παλιές ροές συνεχίζουν να βλέπουν network/timeout ως FAILED. */
export async function sendMail(input: SendMailInput): Promise<"SENT" | "FAILED" | "SKIPPED" | "DUPLICATE"> {
  const status = await sendMailDetailed(input);
  return status === "UNCONFIRMED" ? "FAILED" : status;
}

/** Οι παραλήπτες των μηνυμάτων συνδρομής μιας επιχείρησης: το email επικοινωνίας και οι επιχειρηματίες. */
export async function billingRecipients(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { members: { where: { role: { locked: true } }, include: { user: true } } } });
  if (!org) return { org: null, to: [] as string[] };
  return { org, to: [...new Set([org.contactEmail, ...org.members.map((m) => m.user.email)].filter((e): e is string => !!e))] };
}
