import assert from "node:assert/strict";
import { test } from "node:test";
import { writeAudit, type AuditDb, type AuditInput } from "./audit.ts";

const input: AuditInput = {
  orgId: "org-a",
  actor: { id: "u1", name: "  Υπεύθυνος  " },
  action: "stock.transfer.posted",
  entityType: "stock_transfer",
  entityId: "tr1",
  storeId: "s1",
  warehouseId: "w1",
  reason: "  Μεταφορά στο κατάστημα  ",
  metadata: { lineCount: 2, toStatus: "POSTED" },
};

test("audit: καθαρά δεδομένα, actor snapshot και structured metadata", async () => {
  const rows: unknown[] = [];
  const tx = { auditEvent: { create: async (args: { data: unknown }) => { rows.push(args.data); return args.data; } } } as unknown as AuditDb;
  await writeAudit(tx, input);
  assert.deepEqual(rows, [{
    orgId: "org-a",
    actorId: "u1",
    actorName: "Υπεύθυνος",
    action: "stock.transfer.posted",
    entityType: "stock_transfer",
    entityId: "tr1",
    storeId: "s1",
    warehouseId: "w1",
    reason: "Μεταφορά στο κατάστημα",
    metadata: { lineCount: 2, toStatus: "POSTED" },
  }]);
});

test("audit: κενές τιμές γίνονται null και το metadata μπορεί να λείπει", async () => {
  const rows: { reason?: string | null; storeId?: string | null; metadata?: unknown }[] = [];
  const tx = { auditEvent: { create: async (args: { data: { reason?: string | null; storeId?: string | null; metadata?: unknown } }) => { rows.push(args.data); return args.data; } } } as unknown as AuditDb;
  await writeAudit(tx, { ...input, reason: " ", storeId: null, metadata: undefined });
  assert.equal(rows[0].reason, null);
  assert.equal(rows[0].storeId, null);
  assert.equal("metadata" in rows[0], false);
});

test("audit: απορρίπτει άκυρα keys, κενό actor και υπερβολικά μακριά αιτιολογία", async () => {
  let writes = 0;
  const tx = { auditEvent: { create: async () => { writes += 1; } } } as unknown as AuditDb;
  await assert.rejects(writeAudit(tx, { ...input, action: "transfer" }));
  await assert.rejects(writeAudit(tx, { ...input, entityType: "Stock Transfer" }));
  await assert.rejects(writeAudit(tx, { ...input, actor: { id: "u1", name: " " } }));
  await assert.rejects(writeAudit(tx, { ...input, reason: "x".repeat(501) }));
  assert.equal(writes, 0);
});

test("audit: το σφάλμα εγγραφής δεν καταπίνεται, ώστε το transaction να ακυρωθεί", async () => {
  const tx = { auditEvent: { create: async () => { throw new Error("db failed"); } } } as unknown as AuditDb;
  await assert.rejects(writeAudit(tx, input), /db failed/);
});
