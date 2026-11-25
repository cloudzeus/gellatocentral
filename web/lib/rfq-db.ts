// RFQ με δημόσια πρόσβαση μόνο μέσω τυχαίου token· στη βάση αποθηκεύεται αποκλειστικά SHA-256.
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import type { StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { assertParty, assertNonNegativeInt, assertPositiveInt, auditWorkflow, cleanText, nextBusinessNumber, WorkflowError } from "./workflow-db";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createRfq(ctx: StockContext, input: { replyBy: Date; note?: string | null; supplierIds: string[]; lines: { genericItemId: string; quantityBase: number }[] }) {
  if (input.replyBy.getTime() <= Date.now()) throw new WorkflowError("Η προθεσμία προσφοράς πρέπει να είναι μελλοντική");
  if (!input.supplierIds.length || new Set(input.supplierIds).size !== input.supplierIds.length) throw new WorkflowError("Διάλεξε διαφορετικούς προμηθευτές");
  if (!input.lines.length || new Set(input.lines.map((l) => l.genericItemId)).size !== input.lines.length) throw new WorkflowError("Δώσε μία γραμμή ανά είδος");
  const invitations: { supplierId: string; token: string }[] = [];
  const rfq = await stockTransaction(async (tx) => {
    for (const supplierId of input.supplierIds) await assertParty(tx, ctx.orgId, supplierId, "supplier");
    const generics = await tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: input.lines.map((l) => l.genericItemId) }, active: true }, include: { baseUnit: true } });
    if (generics.length !== input.lines.length) throw new WorkflowError("Βρέθηκε άγνωστο είδος");
    const units = new Map(generics.map((g) => [g.id, g.baseUnit.code]));
    const number = await nextBusinessNumber(tx, ctx.orgId, "rfq", "RFQ", () => tx.rfq.count({ where: { orgId: ctx.orgId } }));
    const created = await tx.rfq.create({ data: { orgId: ctx.orgId, number, replyBy: input.replyBy, note: cleanText(input.note, "Σημείωση", 500), createdByName: ctx.userName, lines: { create: input.lines.map((line) => ({ orgId: ctx.orgId, genericItemId: line.genericItemId, quantityBase: assertPositiveInt(line.quantityBase, "Ποσότητα"), unitCode: units.get(line.genericItemId)! })) } } });
    for (const supplierId of input.supplierIds) {
      const token = randomBytes(32).toString("base64url");
      await tx.rfqSupplier.create({ data: { orgId: ctx.orgId, rfqId: created.id, supplierId, tokenHash: hashToken(token), expiresAt: input.replyBy } });
      invitations.push({ supplierId, token });
    }
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "rfq.create", entityType: "rfq", entityId: created.id, metadata: { suppliers: input.supplierIds.length, lines: input.lines.length } });
    return created;
  });
  return { rfq, invitations };
}

export async function regenerateRfqInvitation(ctx: StockContext, rfqSupplierId: string) {
  return stockTransaction(async (tx) => {
    const supplier = await tx.rfqSupplier.findFirst({ where: { id: rfqSupplierId, orgId: ctx.orgId }, include: { rfq: true } });
    if (!supplier || supplier.rfq.status !== "OPEN" || supplier.rfq.replyBy <= new Date()) throw new WorkflowError("Το αίτημα προσφοράς δεν είναι ανοιχτό");
    const token = randomBytes(32).toString("base64url");
    await tx.rfqSupplier.update({ where: { id: supplier.id }, data: { tokenHash: hashToken(token), respondedAt: null, expiresAt: supplier.rfq.replyBy } });
    await tx.rfqQuote.deleteMany({ where: { orgId: ctx.orgId, rfqSupplierId: supplier.id } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "rfq.reinvite", entityType: "rfq", entityId: supplier.rfqId });
    return token;
  });
}

export async function awardRfq(ctx: StockContext, rfqLineId: string, supplierId: string) {
  return stockTransaction(async (tx) => {
    const line = await tx.rfqLine.findFirst({ where: { id: rfqLineId, orgId: ctx.orgId }, include: { rfq: true } });
    const invitation = await tx.rfqSupplier.findFirst({ where: { orgId: ctx.orgId, rfqId: line?.rfqId ?? "", supplierId }, include: { quotes: true } });
    if (!line || line.rfq.status !== "OPEN" || !invitation?.quotes.some((q) => q.rfqLineId === line.id && q.unitPriceHundredths != null)) throw new WorkflowError("Δεν υπάρχει έγκυρη προσφορά για την ανάθεση");
    await tx.rfqLine.update({ where: { id: line.id }, data: { awardedSupplierId: supplierId } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "rfq.award", entityType: "rfq", entityId: line.rfqId, metadata: { lineId: line.id, supplierId } });
  });
}

export async function getPublicRfq(token: string) {
  const invitation = await db.rfqSupplier.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } }, include: { rfq: { include: { lines: true, org: { select: { name: true } } } } } });
  if (!invitation || invitation.rfq.status !== "OPEN") return null;
  const [party, generics] = await Promise.all([
    db.party.findFirst({ where: { id: invitation.supplierId, orgId: invitation.orgId }, select: { name: true } }),
    db.genericItem.findMany({ where: { orgId: invitation.orgId, id: { in: invitation.rfq.lines.map((l) => l.genericItemId) } }, select: { id: true, name: true } }),
  ]);
  return { invitation, party, generics };
}

export async function submitPublicRfq(token: string, quotes: { rfqLineId: string; packagePriceCents?: number | null; unitsPerPackage?: number | null; unitPriceHundredths: number; validTo?: Date | null; note?: string | null }[]) {
  return db.$transaction(async (tx) => {
    const invitation = await tx.rfqSupplier.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } }, include: { rfq: { include: { lines: true } } } });
    if (!invitation || invitation.rfq.status !== "OPEN") throw new WorkflowError("Ο σύνδεσμος προσφοράς έχει λήξει");
    const allowed = new Set(invitation.rfq.lines.map((l) => l.id));
    if (!quotes.length || quotes.length !== allowed.size || new Set(quotes.map((q) => q.rfqLineId)).size !== quotes.length || quotes.some((q) => !allowed.has(q.rfqLineId))) throw new WorkflowError("Συμπλήρωσε όλες τις γραμμές προσφοράς");
    for (const quote of quotes) {
      assertPositiveInt(quote.unitPriceHundredths, "Τιμή");
      if (quote.packagePriceCents != null) assertNonNegativeInt(quote.packagePriceCents, "Τιμή συσκευασίας");
      if (quote.unitsPerPackage != null) assertPositiveInt(quote.unitsPerPackage, "Περιεχόμενο");
      await tx.rfqQuote.upsert({ where: { rfqSupplierId_rfqLineId: { rfqSupplierId: invitation.id, rfqLineId: quote.rfqLineId } }, create: { orgId: invitation.orgId, rfqSupplierId: invitation.id, rfqLineId: quote.rfqLineId, packagePriceCents: quote.packagePriceCents ?? null, unitsPerPackage: quote.unitsPerPackage ?? null, unitPriceHundredths: quote.unitPriceHundredths, validTo: quote.validTo ?? null, note: cleanText(quote.note, "Σημείωση", 300) }, update: { packagePriceCents: quote.packagePriceCents ?? null, unitsPerPackage: quote.unitsPerPackage ?? null, unitPriceHundredths: quote.unitPriceHundredths, validTo: quote.validTo ?? null, note: cleanText(quote.note, "Σημείωση", 300) } });
    }
    await tx.rfqSupplier.update({ where: { id: invitation.id }, data: { respondedAt: new Date() } });
  });
}
