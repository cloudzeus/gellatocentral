import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test, type TestContext } from "node:test";
import type { StockContext } from "./stock-scope.ts";
import type { LoadedDocument } from "./documents/model.ts";
import type { DeliveryRecipient, DocumentDeliveryDeps } from "./document-delivery.ts";

type ResolveHooks = { registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown): unknown }): void };
(nodeModule as unknown as ResolveHooks).registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || /\.[a-z]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.${specifier.startsWith(".") ? "ts" : "js"}`, context);
    }
  },
});

const { deliverDocument, DocumentDeliveryError, prepareEmail, resolveRecipient, sendViberText, validViberReceiver } = await import("./document-delivery.ts");
const { redactDeliveryText } = await import("./mail/send.ts");
const { db } = await import("./db.ts");

const ctx: StockContext = { orgId: "org-own", membershipId: "member-1", userId: "user-1", userName: "Tester", permissions: ["orders.edit"], storeIds: [], warehouseIds: [], can: () => true };
const loaded: LoadedDocument = {
  model: {
    entityType: "purchase_order", entityId: "order-1", filename: "order-1", title: "Παραγγελία 1",
    brand: { name: "Tenant", legalName: null, vatNumber: "123456789", address: null, city: null, postalCode: null, phone: null, labelExtraText: null }, sections: [],
  },
  scope: { warehouseId: "warehouse-1" },
};
const recipient: DeliveryRecipient = { id: "party-1", key: "party:party-1", kind: "party", name: "Προμηθευτής", email: "supplier@example.com", viberReceiver: "subscriber-abc-123" };
const organization = { id: ctx.orgId, name: "Tenant", slug: "tenant", contactEmail: "owner@example.com", emailFromName: null, externalSendingEnabled: true };

function deps(overrides: Partial<DocumentDeliveryDeps> = {}): DocumentDeliveryDeps {
  return {
    loadOrganization: async () => organization,
    resolveRecipient: async () => recipient,
    claimReceipt: async () => ({ outcome: "CLAIMED", id: "receipt-1" }),
    completeReceipt: async (_ctx, _loaded, _channel, _recipient, _id, status, detail) => ({ status, deliveryStatus: status, detail }),
    prepareEmail: async () => ({ mail: { subject: "Έγγραφο", text: "Κείμενο", html: "<p>Κείμενο</p>" }, template: "document.delivery", attachments: [] }),
    mailConfigured: async () => true,
    viberConfig: async () => ({ token: "test-token", senderName: "Tenant" }),
    sendMailDetailed: async () => "SENT",
    sendViberText: async () => ({ status: "SENT", detail: "ok" }),
    ...overrides,
  };
}

const emailInput = { channel: "email" as const, recipientId: recipient.id, confirm: true };

test("delivery: default tenant disabled δεν προετοιμάζει και δεν καλεί provider", async () => {
  let preparations = 0, providers = 0;
  const result = await deliverDocument(ctx, loaded, emailInput, deps({
    loadOrganization: async () => ({ ...organization, externalSendingEnabled: false }),
    claimReceipt: async (_ctx, _loaded, _channel, _recipient, blocked) => {
      assert.equal(blocked?.status, "DISABLED");
      return { outcome: "BLOCKED", result: { status: "DISABLED", deliveryStatus: "DISABLED", detail: blocked.detail } };
    },
    prepareEmail: async () => { preparations += 1; throw new Error("forbidden preparation"); },
    sendMailDetailed: async () => { providers += 1; return "SENT"; },
  }));
  assert.equal(result.status, "DISABLED");
  assert.deepEqual([preparations, providers], [0, 0]);
});

test("delivery: SENT, SENDING και UNCONFIRMED replay μπλοκάρονται πριν από preparation/provider", async () => {
  for (const deliveryStatus of ["SENT", "SENDING", "UNCONFIRMED"] as const) {
    let preparations = 0, providers = 0;
    const result = await deliverDocument(ctx, loaded, emailInput, deps({
      claimReceipt: async () => ({ outcome: "REPLAY", result: { status: "DUPLICATE", deliveryStatus, detail: "replay blocked" } }),
      prepareEmail: async () => { preparations += 1; throw new Error("forbidden preparation"); },
      sendMailDetailed: async () => { providers += 1; return "SENT"; },
    }));
    assert.equal(result.status, "DUPLICATE");
    assert.equal(result.deliveryStatus, deliveryStatus);
    assert.deepEqual([preparations, providers], [0, 0]);
  }
});

test("delivery: FAILED επιτρέπει νέα ρητή προσπάθεια και claim", async () => {
  let claims = 0, providers = 0;
  const mocked = deps({
    claimReceipt: async () => { claims += 1; return { outcome: "CLAIMED", id: `receipt-${claims}` }; },
    sendMailDetailed: async () => { providers += 1; return providers === 1 ? "FAILED" : "SENT"; },
  });
  assert.equal((await deliverDocument(ctx, loaded, emailInput, mocked)).status, "FAILED");
  assert.equal((await deliverDocument(ctx, loaded, emailInput, mocked)).status, "SENT");
  assert.deepEqual([claims, providers], [2, 2]);
});

test("delivery: preparation exception καταλήγει ABORTED, όχι provider FAILED", async () => {
  let providers = 0;
  const result = await deliverDocument(ctx, loaded, emailInput, deps({
    prepareEmail: async () => { throw new Error("PDF failed"); },
    sendMailDetailed: async () => { providers += 1; return "SENT"; },
  }));
  assert.equal(result.status, "ABORTED");
  assert.equal(providers, 0);
});

test("delivery: σφάλμα completion μετά από SENT δεν προκαλεί δεύτερο completion/ABORTED", async () => {
  const completions: string[] = [];
  await assert.rejects(deliverDocument(ctx, loaded, emailInput, deps({
    completeReceipt: async (_ctx, _loaded, _channel, _recipient, _id, status) => { completions.push(status); throw new Error("audit failed"); },
  })), /audit failed/);
  assert.deepEqual(completions, ["SENT"]);
});

test("delivery: schedule χωρίς subscriber ID παραμένει Viber DISABLED", async () => {
  let providers = 0;
  const schedule = { ...loaded, model: { ...loaded.model, entityType: "schedule_publication" as const } };
  const result = await deliverDocument(ctx, schedule, { channel: "viber", recipientId: "employee-1", confirm: true }, deps({
    resolveRecipient: async () => ({ ...recipient, id: "employee-1", key: "employee:employee-1", kind: "employee", viberReceiver: null }),
    claimReceipt: async (_ctx, _loaded, _channel, _recipient, blocked) => {
      assert.equal(blocked?.status, "DISABLED");
      return { outcome: "BLOCKED", result: { status: "DISABLED", deliveryStatus: "DISABLED", detail: blocked.detail } };
    },
    sendViberText: async () => { providers += 1; return { status: "SENT", detail: "forbidden" }; },
  }));
  assert.equal(result.status, "DISABLED");
  assert.equal(providers, 0);
  assert.equal(validViberReceiver("+306901234567"), null);
  assert.equal(validViberReceiver("subscriber-abc-123"), "subscriber-abc-123");
});

test("Viber provider: HTTP 2xx + status 0 + message_token είναι SENT και στέλνει official contract", async () => {
  let requestBody: Record<string, unknown> = {};
  const fetchMock: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://chatapi.viber.com/pa/send_message");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["X-Viber-Auth-Token"], "secret-token");
    assert.ok(init?.signal instanceof AbortSignal);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ status: 0, message_token: 12345 });
  };
  const result = await sendViberText({ token: "secret-token", senderName: "Tenant", receiver: "subscriber-abc", text: "Ειδοποίηση", trackingData: "tracking" }, fetchMock);
  assert.equal(result.status, "SENT");
  assert.equal(requestBody.receiver, "subscriber-abc");
  assert.equal(requestBody.type, "text");
  assert.equal(requestBody.text, "Ειδοποίηση");
});

test("Viber provider: nonzero status είναι FAILED, malformed/network είναι UNCONFIRMED", async () => {
  const rejected = await sendViberText({ token: "secret-token", senderName: "Tenant", receiver: "subscriber", text: "text", trackingData: "tracking" }, async () => Response.json({ status: 6, status_message: "not subscribed" }));
  assert.equal(rejected.status, "FAILED");
  const malformed = await sendViberText({ token: "secret-token", senderName: "Tenant", receiver: "subscriber", text: "text", trackingData: "tracking" }, async () => new Response("not-json", { status: 200 }));
  assert.equal(malformed.status, "UNCONFIRMED");
  const network = await sendViberText({ token: "secret-token", senderName: "Tenant", receiver: "subscriber", text: "text", trackingData: "tracking" }, async () => { throw new Error("socket closed"); });
  assert.equal(network.status, "UNCONFIRMED");
});

test("delivery redaction: αφαιρεί secret, πλήρες email και τηλέφωνο", () => {
  const secret = "viber-secret-token-123456";
  const text = redactDeliveryText(`Failure ${secret} supplier@example.com +30 210 123 4567`, [secret]);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("supplier@example.com"), false);
  assert.equal(text.includes("+30 210 123 4567"), false);
  assert.ok(text.includes("[redacted]"));
});

test("schedule email: ICS περιέχει μόνο τις βάρδιες του επιλεγμένου employee", async () => {
  const own = { id: "shift-own", employeeId: "employee-1", employeeName: "Εργαζόμενος Α", startsAt: "2026-11-24T08:00:00.000Z", endsAt: "2026-11-24T16:00:00.000Z", breakMinutes: 30, note: null, departmentName: null, storeName: "Κέντρο" };
  const other = { ...own, id: "shift-other", employeeId: "employee-2", employeeName: "Εργαζόμενος Β", startsAt: "2026-11-25T08:00:00.000Z", endsAt: "2026-11-25T16:00:00.000Z" };
  const schedule: LoadedDocument = {
    model: { ...loaded.model, entityType: "schedule_publication", entityId: "pub-1", title: "Πρόγραμμα βαρδιών" },
    scope: { storeId: "store-1" },
    schedule: { snapshot: { shifts: [own, other] }, version: 3, fromAt: new Date("2026-11-24T00:00:00.000Z"), toAt: new Date("2026-11-30T00:00:00.000Z") },
  };
  const prepared = await prepareEmail(ctx, schedule, { ...recipient, id: "employee-1", key: "employee:employee-1", kind: "employee" });
  const ics = new TextDecoder().decode(prepared.attachments[0]?.data);
  assert.equal(prepared.attachments[0]?.filename, "schedule-v3.ics");
  assert.ok(ics.includes("UID:shift-own-v3@gelato"));
  assert.equal(ics.includes("shift-other"), false);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
});

function replaceMethod(t: TestContext, object: object, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { value, configurable: true, writable: true });
  t.after(() => previous ? Object.defineProperty(object, key, previous) : Reflect.deleteProperty(object, key));
}

test("recipient resolution: ξένος tenant ή μη συσχετισμένος party απορρίπτεται", async (t) => {
  let partyReads = 0;
  replaceMethod(t, db.purchaseOrder, "findFirst", async (query: { where: { orgId: string } }) => query.where.orgId === ctx.orgId ? { supplierId: "party-1" } : null);
  replaceMethod(t, db.party, "findFirst", async (query: { where: { id: string; orgId: string } }) => {
    partyReads += 1;
    assert.equal(query.where.orgId, ctx.orgId);
    return { id: "party-1", name: "Προμηθευτής", email: "supplier@example.com" };
  });
  replaceMethod(t, db.partyChannel, "findFirst", async () => ({ value: "subscriber-abc-123" }));
  const own = await resolveRecipient(ctx, loaded, "party-1");
  assert.equal(own.id, "party-1");
  await assert.rejects(resolveRecipient(ctx, loaded, "party-other"), (error: unknown) => error instanceof DocumentDeliveryError && error.status === 403);
  await assert.rejects(resolveRecipient({ ...ctx, orgId: "org-foreign" }, loaded, "party-1"), (error: unknown) => error instanceof DocumentDeliveryError && error.status === 403);
  assert.equal(partyReads, 1);
});
