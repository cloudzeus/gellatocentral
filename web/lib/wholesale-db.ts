// Χονδρική: ειδικές τιμές, FEFO παράδοση, παραστατικά, εισπράξεις και B2B σε κοινό tenant context.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { docTypeInfo } from "./documents/types";
import { advanceSeries, lockSeries, SeriesError } from "./documents/series";
import { sumDocumentTotals } from "./procurement";
import { allocateFefo } from "./production";
import { postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { assertGlobalStockScope, assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { stockCostScale } from "./units";
import { assertNonNegativeInt, assertParty, assertPositiveInt, auditWorkflow, cleanText, nextBusinessNumber, WorkflowError } from "./workflow-db";
import { canWholesaleQuoteTransition, hashAccessToken, outstandingCents, paymentUnappliedCents, selectPriceList, validExternalKey, wholesaleQuoteOrderInput, type WholesaleQuoteLifecycleStatus } from "./wholesale";

export type WholesaleLineInput = { genericItemId: string; quantityBase: number; unitPriceCents: number; vatRate: number };
export type WholesaleOrderInput = { customerId: string; storeId: string; warehouseId: string; neededAt?: Date | null; note?: string | null; lines: WholesaleLineInput[]; externalKey?: string | null };
type Tx = Prisma.TransactionClient;
type Allocation = { genericItemId: string; lotId: string; quantityBase: number; unitPriceCents: number; vatRate: number; costHundredths: number };

function translate(error: unknown): never {
  if (error instanceof StockError) throw new WorkflowError(STOCK_ERROR_MESSAGE[error.code]);
  if (error instanceof StockScopeError) throw new WorkflowError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
  throw error;
}
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });
const validDate = (value: Date | null | undefined, label: string) => { if (value && Number.isNaN(value.getTime())) throw new WorkflowError(`Άκυρη ${label}`); };

async function orderInScope(tx: Tx, ctx: StockContext, orderId: string, forWrite = true) {
  const order = await tx.wholesaleOrder.findFirst({ where: { id: orderId, orgId: ctx.orgId }, include: { lines: true } });
  if (!order) throw new WorkflowError("Η παραγγελία χονδρικής δεν βρέθηκε");
  await assertStockScope(tx, ctx, { storeId: order.storeId, warehouseId: order.warehouseId, forWrite });
  return order;
}

async function insertOrder(tx: Tx, ctx: { orgId: string; userId: string | null; userName: string }, input: WholesaleOrderInput, source: string) {
  if (!input.lines.length || input.lines.length > 200) throw new WorkflowError("Η παραγγελία χρειάζεται 1–200 γραμμές");
  if (new Set(input.lines.map((line) => line.genericItemId)).size !== input.lines.length) throw new WorkflowError("Κάθε είδος επιτρέπεται μία φορά");
  if (input.externalKey && !validExternalKey(input.externalKey)) throw new WorkflowError("Άκυρο κλειδί παραγγελίας");
  validDate(input.neededAt, "ημερομηνία παράδοσης");
  if (input.externalKey) {
    const previous = await tx.wholesaleOrder.findFirst({ where: { orgId: ctx.orgId, source, externalKey: input.externalKey }, include: { lines: true } });
    if (previous) {
      if (previous.customerId !== input.customerId) throw new WorkflowError("Το κλειδί παραγγελίας ανήκει σε άλλο πελάτη");
      return previous;
    }
  }
  const customer = await assertParty(tx, ctx.orgId, input.customerId, "customer");
  const generics = await tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: input.lines.map((line) => line.genericItemId) }, active: true, trackStock: true }, include: { baseUnit: true } });
  if (generics.length !== input.lines.length) throw new WorkflowError("Βρέθηκε άγνωστο ή μη αποθευτικό είδος");
  const scales = new Map(generics.map((generic) => [generic.id, stockCostScale(generic.baseUnit.dimension)]));
  for (const line of input.lines) {
    assertPositiveInt(line.quantityBase, "Ποσότητα");
    assertNonNegativeInt(line.unitPriceCents, "Τιμή");
    assertNonNegativeInt(line.vatRate, "ΦΠΑ", 100);
  }
  const totals = sumDocumentTotals(input.lines.map((line) => ({ ...line, costScale: scales.get(line.genericItemId) })));
  const number = await nextBusinessNumber(tx, ctx.orgId, "wholesale-order", "ΧΠ", () => tx.wholesaleOrder.count({ where: { orgId: ctx.orgId } }));
  const order = await tx.wholesaleOrder.create({ data: {
    orgId: ctx.orgId, customerId: customer.id, storeId: input.storeId, warehouseId: input.warehouseId, number,
    neededAt: input.neededAt ?? null, note: cleanText(input.note, "Σημείωση", 500), ...totals, source,
    externalKey: input.externalKey ?? null, createdByName: ctx.userName,
    lines: { create: input.lines.map((line) => ({ orgId: ctx.orgId, genericItemId: line.genericItemId, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate })) },
  }, include: { lines: true } });
  await auditWorkflow(tx, { orgId: ctx.orgId, actor: { id: ctx.userId, name: ctx.userName }, action: "wholesale.create", entityType: "wholesale_order", entityId: order.id, storeId: order.storeId, warehouseId: order.warehouseId, metadata: { number, source, totalCents: totals.totalCents } });
  return order;
}

export async function createWholesaleOrder(ctx: StockContext, input: WholesaleOrderInput) {
  try {
    return await stockTransaction(async (tx) => {
      await assertStockScope(tx, ctx, { storeId: input.storeId, warehouseId: input.warehouseId, forWrite: true });
      return insertOrder(tx, ctx, input, "backoffice");
    });
  } catch (error) { translate(error); }
}

export type WholesaleQuoteInput = WholesaleOrderInput & { validUntil: Date };

async function quoteInScope(tx: Tx, ctx: StockContext, quoteId: string, forWrite = true) {
  const quote = await tx.wholesaleQuote.findFirst({ where: { id: quoteId, orgId: ctx.orgId }, include: { lines: true } });
  if (!quote) throw new WorkflowError("Η προσφορά χονδρικής δεν βρέθηκε");
  await assertStockScope(tx, ctx, { storeId: quote.storeId, warehouseId: quote.warehouseId, forWrite });
  return quote;
}

async function validatedQuote(tx: Tx, ctx: StockContext, input: WholesaleQuoteInput) {
  if (!input.lines.length || input.lines.length > 200) throw new WorkflowError("Η προσφορά χρειάζεται 1–200 γραμμές");
  if (new Set(input.lines.map((line) => line.genericItemId)).size !== input.lines.length) throw new WorkflowError("Κάθε είδος επιτρέπεται μία φορά");
  validDate(input.validUntil, "ημερομηνία λήξης");
  validDate(input.neededAt, "ημερομηνία παράδοσης");
  if (input.validUntil.getTime() <= Date.now()) throw new WorkflowError("Η ισχύς της προσφοράς πρέπει να είναι μελλοντική");
  const customer = await assertParty(tx, ctx.orgId, input.customerId, "customer");
  const generics = await tx.genericItem.findMany({ where: { orgId: ctx.orgId, id: { in: input.lines.map((line) => line.genericItemId) }, active: true, trackStock: true }, include: { baseUnit: true } });
  if (generics.length !== input.lines.length) throw new WorkflowError("Βρέθηκε άγνωστο ή μη αποθευτικό είδος");
  const byId = new Map(generics.map((generic) => [generic.id, generic]));
  for (const line of input.lines) {
    assertPositiveInt(line.quantityBase, "Ποσότητα");
    assertNonNegativeInt(line.unitPriceCents, "Τιμή");
    assertNonNegativeInt(line.vatRate, "ΦΠΑ", 100);
  }
  const totals = sumDocumentTotals(input.lines.map((line) => ({ ...line, costScale: stockCostScale(byId.get(line.genericItemId)!.baseUnit.dimension) })));
  const lineData = input.lines.map((line) => {
    const generic = byId.get(line.genericItemId)!;
    const dimension = generic.baseUnit.dimension;
    return {
      orgId: ctx.orgId, genericItemId: line.genericItemId, description: generic.name,
      unitLabel: dimension === "mass" ? "kg" : dimension === "volume" ? "l" : "1000 τεμ.",
      unitScale: stockCostScale(dimension), quantityBase: line.quantityBase,
      unitPriceCents: line.unitPriceCents, vatRate: line.vatRate,
    };
  });
  return {
    customerId: customer.id, storeId: input.storeId, warehouseId: input.warehouseId,
    validUntil: input.validUntil, neededAt: input.neededAt ?? null,
    note: cleanText(input.note, "Σημείωση", 500), ...totals,
    customerSnapshot: snapshot(customer), lineData,
  };
}

export async function createWholesaleQuote(ctx: StockContext, input: WholesaleQuoteInput) {
  try {
    return await stockTransaction(async (tx) => {
      await assertStockScope(tx, ctx, { storeId: input.storeId, warehouseId: input.warehouseId, forWrite: true });
      const data = await validatedQuote(tx, ctx, input);
      const number = await nextBusinessNumber(tx, ctx.orgId, "wholesale-quote", "ΠΡ", () => tx.wholesaleQuote.count({ where: { orgId: ctx.orgId } }));
      const quote = await tx.wholesaleQuote.create({ data: {
        orgId: ctx.orgId, number, createdByName: ctx.userName,
        customerId: data.customerId, storeId: data.storeId, warehouseId: data.warehouseId,
        validUntil: data.validUntil, neededAt: data.neededAt, note: data.note,
        netCents: data.netCents, vatCents: data.vatCents, totalCents: data.totalCents,
        customerSnapshot: data.customerSnapshot, lines: { create: data.lineData },
      }, include: { lines: true } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.quote.create", entityType: "wholesale_quote", entityId: quote.id, storeId: quote.storeId, warehouseId: quote.warehouseId, metadata: { number, totalCents: quote.totalCents } });
      return quote;
    });
  } catch (error) { translate(error); }
}

export async function updateWholesaleQuote(ctx: StockContext, quoteId: string, input: WholesaleQuoteInput) {
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wholesale-quote:${ctx.orgId}:${quoteId}`}, 0))) AS lock`;
      const quote = await quoteInScope(tx, ctx, quoteId);
      if (quote.status !== "DRAFT") throw new WorkflowError("Μόνο πρόχειρη προσφορά επεξεργάζεται");
      await assertStockScope(tx, ctx, { storeId: input.storeId, warehouseId: input.warehouseId, forWrite: true });
      const data = await validatedQuote(tx, ctx, input);
      const updated = await tx.wholesaleQuote.update({ where: { id: quote.id }, data: {
        customerId: data.customerId, storeId: data.storeId, warehouseId: data.warehouseId,
        validUntil: data.validUntil, neededAt: data.neededAt, note: data.note,
        netCents: data.netCents, vatCents: data.vatCents, totalCents: data.totalCents,
        customerSnapshot: data.customerSnapshot, lines: { deleteMany: {}, create: data.lineData },
      }, include: { lines: true } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.quote.update", entityType: "wholesale_quote", entityId: quote.id, storeId: quote.storeId, warehouseId: quote.warehouseId, metadata: { number: quote.number, totalCents: updated.totalCents } });
      return updated;
    });
  } catch (error) { translate(error); }
}

async function transitionWholesaleQuote(ctx: StockContext, quoteId: string, target: WholesaleQuoteLifecycleStatus, reason?: string) {
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wholesale-quote:${ctx.orgId}:${quoteId}`}, 0))) AS lock`;
      const quote = await quoteInScope(tx, ctx, quoteId);
      if (!canWholesaleQuoteTransition(quote.status, target)) throw new WorkflowError("Η μετάβαση δεν επιτρέπεται στην τρέχουσα κατάσταση");
      const now = new Date();
      if (["SENT", "ACCEPTED"].includes(target) && quote.validUntil <= now) throw new WorkflowError("Η προσφορά έχει λήξει και δεν μπορεί να προχωρήσει");
      if (target === "EXPIRED" && quote.validUntil > now) throw new WorkflowError("Η προσφορά ισχύει ακόμη και δεν σημαίνεται ληγμένη");
      const cleanReason = target === "REJECTED" ? cleanText(reason, "Αιτιολογία απόρριψης", 300, true) : null;
      const data: Prisma.WholesaleQuoteUpdateInput = target === "SENT" ? { status: target, sentAt: now }
        : target === "ACCEPTED" ? { status: target, acceptedAt: now }
          : target === "REJECTED" ? { status: target, rejectedAt: now, rejectionReason: cleanReason }
            : { status: target, expiredAt: now };
      const updated = await tx.wholesaleQuote.update({ where: { id: quote.id }, data });
      if (target === "SENT") await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: "wholesale_quote", entityId: quote.id, channel: "internal", status: "RECORDED", detail: "Σήμανση προσφοράς ως απεσταλμένης· δεν πραγματοποιήθηκε εξωτερική αποστολή", createdByName: ctx.userName } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: `wholesale.quote.${target.toLowerCase()}`, entityType: "wholesale_quote", entityId: quote.id, storeId: quote.storeId, warehouseId: quote.warehouseId, reason: cleanReason, metadata: { number: quote.number, from: quote.status, to: target } });
      return updated;
    });
  } catch (error) { translate(error); }
}

export const sendWholesaleQuote = (ctx: StockContext, quoteId: string) => transitionWholesaleQuote(ctx, quoteId, "SENT");
export const acceptWholesaleQuote = (ctx: StockContext, quoteId: string) => transitionWholesaleQuote(ctx, quoteId, "ACCEPTED");
export const rejectWholesaleQuote = (ctx: StockContext, quoteId: string, reason: string) => transitionWholesaleQuote(ctx, quoteId, "REJECTED", reason);
export const expireWholesaleQuote = (ctx: StockContext, quoteId: string) => transitionWholesaleQuote(ctx, quoteId, "EXPIRED");

export async function convertWholesaleQuote(ctx: StockContext, quoteId: string) {
  try {
    return await stockTransaction(async (tx) => {
      // Το lock και το μοναδικό orderId καλύπτουν replay και ταυτόχρονες αιτήσεις.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wholesale-quote:${ctx.orgId}:${quoteId}`}, 0))) AS lock`;
      const quote = await quoteInScope(tx, ctx, quoteId, false);
      if (quote.orderId) return tx.wholesaleOrder.findFirstOrThrow({ where: { id: quote.orderId, orgId: ctx.orgId }, include: { lines: true } });
      if (quote.status !== "ACCEPTED") throw new WorkflowError("Μόνο αποδεκτή προσφορά μετατρέπεται σε παραγγελία");
      await assertStockScope(tx, ctx, { storeId: quote.storeId, warehouseId: quote.warehouseId, forWrite: true });
      const order = await insertOrder(tx, ctx, wholesaleQuoteOrderInput(quote), "quote");
      // Δεν καλείται confirm/deliver/invoice: η νέα παραγγελία παραμένει DRAFT.
      await tx.wholesaleQuote.update({ where: { id: quote.id }, data: { orderId: order.id, convertedAt: new Date() } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.quote.convert", entityType: "wholesale_quote", entityId: quote.id, storeId: quote.storeId, warehouseId: quote.warehouseId, metadata: { quoteNumber: quote.number, orderId: order.id, orderNumber: order.number } });
      return order;
    });
  } catch (error) { translate(error); }
}

export async function savePriceList(ctx: StockContext, input: { name: string; validFrom: Date; validTo?: Date | null; customerId?: string | null; lines: { genericItemId: string; unitPriceCents: number; vatRate: number }[] }) {
  assertGlobalStockScope(ctx);
  const name = cleanText(input.name, "Όνομα τιμοκαταλόγου", 100, true)!;
  validDate(input.validFrom, "έναρξη ισχύος");
  validDate(input.validTo, "λήξη ισχύος");
  if (input.validTo && input.validTo < input.validFrom) throw new WorkflowError("Η λήξη προηγείται της έναρξης");
  if (!input.lines.length || input.lines.length > 500 || new Set(input.lines.map((line) => line.genericItemId)).size !== input.lines.length) throw new WorkflowError("Ο τιμοκατάλογος χρειάζεται μοναδικά είδη, 1–500 γραμμές");
  return stockTransaction(async (tx) => {
    if (input.customerId) await assertParty(tx, ctx.orgId, input.customerId, "customer");
    const owned = await tx.genericItem.count({ where: { orgId: ctx.orgId, id: { in: input.lines.map((line) => line.genericItemId) }, active: true, trackStock: true } });
    if (owned !== input.lines.length) throw new WorkflowError("Βρέθηκε άγνωστο είδος τιμοκαταλόγου");
    for (const line of input.lines) { assertNonNegativeInt(line.unitPriceCents, "Τιμή"); assertNonNegativeInt(line.vatRate, "ΦΠΑ", 100); }
    const list = await tx.priceList.create({ data: {
      orgId: ctx.orgId, name, validFrom: input.validFrom, validTo: input.validTo ?? null,
      parties: input.customerId ? { create: [{ orgId: ctx.orgId, partyId: input.customerId }] } : undefined,
      items: { create: input.lines.map((line) => ({ orgId: ctx.orgId, genericItemId: line.genericItemId, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate })) },
    } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.pricelist", entityType: "price_list", entityId: list.id, metadata: { customerId: input.customerId ?? null, lines: input.lines.length } });
    return list;
  });
}

export async function confirmWholesaleOrder(ctx: StockContext, orderId: string) {
  return stockTransaction(async (tx) => {
    const order = await orderInScope(tx, ctx, orderId);
    if (order.status !== "DRAFT") throw new WorkflowError("Μόνο πρόχειρη παραγγελία επιβεβαιώνεται");
    const updated = await tx.wholesaleOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    await tx.documentDelivery.create({ data: { orgId: ctx.orgId, entityType: "wholesale_order", entityId: order.id, channel: "internal", status: "RECORDED", detail: "Επιβεβαίωση παραγγελίας· δεν πραγματοποιήθηκε εξωτερική αποστολή", createdByName: ctx.userName } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.confirm", entityType: "wholesale_order", entityId: order.id, storeId: order.storeId, warehouseId: order.warehouseId });
    return updated;
  });
}

export async function cancelWholesaleOrder(ctx: StockContext, orderId: string, reason: string) {
  const cleanReason = cleanText(reason, "Αιτιολογία", 300, true);
  return stockTransaction(async (tx) => {
    const order = await orderInScope(tx, ctx, orderId);
    if (!["DRAFT", "CONFIRMED"].includes(order.status)) throw new WorkflowError("Η παραγγελία δεν ακυρώνεται σε αυτή την κατάσταση");
    const [documents, stops] = await Promise.all([tx.salesDocument.count({ where: { orgId: ctx.orgId, orderId: order.id } }), tx.deliveryStop.count({ where: { orgId: ctx.orgId, orderId: order.id } })]);
    if (documents || stops) throw new WorkflowError("Υπάρχουν παραστατικά ή δρομολόγιο· ακύρωσε πρώτα αυτά μέσω των προβλεπόμενων αντιθέτων ενεργειών");
    const updated = await tx.wholesaleOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", note: [order.note, `Ακύρωση: ${cleanReason}`].filter(Boolean).join("\n") } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.cancel", entityType: "wholesale_order", entityId: order.id, storeId: order.storeId, warehouseId: order.warehouseId, reason: cleanReason });
    return updated;
  });
}

async function allocateOrder(tx: Tx, order: { id: string; orgId: string; warehouseId: string; lines: { genericItemId: string; quantityBase: number; unitPriceCents: number; vatRate: number }[] }): Promise<Allocation[]> {
  const result: Allocation[] = [];
  for (const line of order.lines) {
    const generic = await tx.genericItem.findFirst({ where: { id: line.genericItemId, orgId: order.orgId, active: true, trackStock: true }, include: { baseUnit: true } });
    if (!generic) throw new WorkflowError("Το είδος παραγγελίας δεν είναι πλέον διαθέσιμο");
    const lots = await tx.stockLot.findMany({ where: { orgId: order.orgId, genericItemId: generic.id, warehouseId: order.warehouseId, holdStatus: { in: ["AVAILABLE", "RELEASED"] } }, orderBy: { createdAt: "asc" } });
    const sums = lots.length ? await tx.stockMovement.groupBy({ by: ["lotId"], where: { orgId: order.orgId, lotId: { in: lots.map((lot) => lot.id) } }, _sum: { quantity: true } }) : [];
    const balances = new Map(sums.map((sum) => [sum.lotId, sum._sum.quantity ?? 0]));
    const allocations = allocateFefo(lots.map((lot) => ({ id: lot.id, expiresAt: lot.expiresAt, available: balances.get(lot.id) ?? 0 })), line.quantityBase);
    if (!allocations) throw new WorkflowError(`Ανεπαρκές διαθέσιμο απόθεμα για «${generic.name}»`);
    const scale = stockCostScale(generic.baseUnit.dimension);
    for (const allocation of allocations) result.push({
      genericItemId: generic.id, lotId: allocation.lotId, quantityBase: allocation.qty,
      unitPriceCents: line.unitPriceCents, vatRate: line.vatRate,
      costHundredths: Math.round(allocation.qty * generic.avgCostHundredths / scale),
    });
  }
  return result;
}

function snapshot(customer: { id: string; name: string; vatNumber: string | null; countryCode: string; address: string | null; city: string | null; postalCode: string | null }) {
  return { id: customer.id, name: customer.name, vatNumber: customer.vatNumber, countryCode: customer.countryCode, address: customer.address, city: customer.city, postalCode: customer.postalCode };
}

async function issueDocument(tx: Tx, ctx: StockContext, order: { id: string; orgId: string; customerId: string; storeId: string; warehouseId: string; netCents: number; vatCents: number; totalCents: number }, input: { docType: "1.1" | "5.1" | "9.3"; seriesId: string; issuedAt: Date; dueAt?: Date | null; allocations: Allocation[]; relatedFiscalId?: string | null }) {
  docTypeInfo(input.docType);
  const customer = await tx.party.findFirst({ where: { id: order.customerId, orgId: ctx.orgId } });
  if (!customer?.vatNumber) throw new WorkflowError("Το παραστατικό απαιτεί πελάτη με ΑΦΜ");
  const locked = await lockSeries(tx, ctx.orgId, input.seriesId, input.docType).catch((error) => { throw error instanceof SeriesError ? new WorkflowError(error.message) : error; });
  if (locked.storeId && locked.storeId !== order.storeId) throw new WorkflowError("Η σειρά ανήκει σε άλλο κατάστημα");
  const code = locked.code;
  const receiptReference = randomUUID();
  const fiscal = await tx.fiscalDocument.create({ data: {
    orgId: ctx.orgId, partyId: customer.id, seriesId: locked.id, docType: input.docType, relatedId: input.relatedFiscalId ?? null,
    receiptReference, status: "NOT_SENT", error: "Δεν έχει γίνει διαβίβαση myDATA",
    request: { transmission: "NOT_SENT", docType: input.docType, series: code, aa: locked.nextAa, issuedAt: input.issuedAt.toISOString(), orderId: order.id, totalCents: order.totalCents },
  } });
  const document = await tx.salesDocument.create({ data: {
    orgId: ctx.orgId, orderId: order.id, customerId: customer.id, storeId: order.storeId, warehouseId: order.warehouseId,
    seriesId: locked.id, fiscalDocumentId: fiscal.id, docType: input.docType, series: code, aa: locked.nextAa,
    issuedAt: input.issuedAt, dueAt: input.dueAt ?? null, netCents: order.netCents, vatCents: order.vatCents, totalCents: order.totalCents,
    customerSnapshot: snapshot(customer), createdByName: ctx.userName,
    lines: { create: input.allocations.map((line) => ({ orgId: ctx.orgId, genericItemId: line.genericItemId, lotId: line.lotId, quantityBase: line.quantityBase, unitPriceCents: line.unitPriceCents, vatRate: line.vatRate, costHundredths: line.costHundredths })) },
  }, include: { lines: true } });
  await advanceSeries(tx, locked.id);
  return document;
}

export async function deliverWholesaleOrder(ctx: StockContext, input: { orderId: string; seriesId: string; deliveredAt?: Date; recipientName?: string | null; proofNote?: string | null; stopId?: string | null }) {
  try {
    return await stockTransaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wholesale-order:${ctx.orgId}:${input.orderId}`}, 0))) AS lock`;
      const order = await orderInScope(tx, ctx, input.orderId);
      if (order.status !== "CONFIRMED") throw new WorkflowError("Μόνο επιβεβαιωμένη παραγγελία παραδίδεται");
      if (input.stopId) {
        const stop = await tx.deliveryStop.findFirst({ where: { id: input.stopId, orgId: ctx.orgId, orderId: order.id, deliveredAt: null }, include: { route: true } });
        if (!stop) throw new WorkflowError("Η στάση παράδοσης δεν βρέθηκε ή έχει ολοκληρωθεί");
        await assertStockScope(tx, ctx, { storeId: stop.route.storeId ?? order.storeId, warehouseId: order.warehouseId, forWrite: true });
      }
      const deliveredAt = input.deliveredAt ?? new Date();
      validDate(deliveredAt, "ημερομηνία παράδοσης");
      const allocations = await allocateOrder(tx, order);
      const document = await issueDocument(tx, ctx, order, { docType: "9.3", seriesId: input.seriesId, issuedAt: deliveredAt, allocations });
      for (const line of document.lines) await postStockMovement(tx, {
        orgId: ctx.orgId, storeId: order.storeId, warehouseId: order.warehouseId, documentId: document.id, lineId: line.id,
        genericItemId: line.genericItemId, lotId: line.lotId, quantity: -line.quantityBase,
        source: "wholesale", occurredAt: deliveredAt, actor: actor(ctx),
      });
      await tx.wholesaleOrder.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt } });
      if (input.stopId) {
        await tx.deliveryStop.update({ where: { id: input.stopId }, data: { deliveredAt, recipientName: cleanText(input.recipientName, "Παραλήπτης", 120), proofNote: cleanText(input.proofNote, "Απόδειξη", 500) } });
        const stop = await tx.deliveryStop.findUniqueOrThrow({ where: { id: input.stopId }, select: { routeId: true } });
        if (await tx.deliveryStop.count({ where: { orgId: ctx.orgId, routeId: stop.routeId, deliveredAt: null } }) === 0) await tx.deliveryRoute.update({ where: { id: stop.routeId }, data: { status: "COMPLETED" } });
      }
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.deliver", entityType: "sales_document", entityId: document.id, storeId: order.storeId, warehouseId: order.warehouseId, metadata: { orderId: order.id, stopId: input.stopId ?? null, lines: document.lines.length } });
      return document;
    });
  } catch (error) { translate(error); }
}

export async function invoiceWholesaleOrder(ctx: StockContext, input: { orderId: string; seriesId: string; issuedAt?: Date; dueAt?: Date | null }) {
  return stockTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`wholesale-order:${ctx.orgId}:${input.orderId}`}, 0))) AS lock`;
    const order = await orderInScope(tx, ctx, input.orderId);
    const existing = await tx.salesDocument.findFirst({ where: { orgId: ctx.orgId, orderId: order.id, docType: "1.1", status: "ISSUED" }, include: { lines: true } });
    if (existing) return existing;
    if (await tx.salesDocument.count({ where: { orgId: ctx.orgId, orderId: order.id, docType: "5.1", status: "ISSUED" } })) throw new WorkflowError("Η παραγγελία έχει πιστωθεί και δεν ξανατιμολογείται");
    if (order.status !== "DELIVERED") throw new WorkflowError("Τιμολογείται μόνο παραδοθείσα παραγγελία");
    const delivery = await tx.salesDocument.findFirst({ where: { orgId: ctx.orgId, orderId: order.id, docType: "9.3", status: "ISSUED" }, include: { lines: true }, orderBy: { createdAt: "desc" } });
    if (!delivery) throw new WorkflowError("Δεν βρέθηκε παράδοση για αντιγραφή των παρτίδων");
    const issuedAt = input.issuedAt ?? new Date();
    validDate(issuedAt, "ημερομηνία τιμολογίου");
    validDate(input.dueAt, "ημερομηνία εξόφλησης");
    const allocations = delivery.lines.map((line) => {
      if (!line.lotId) throw new WorkflowError("Η παράδοση περιέχει γραμμή χωρίς παρτίδα");
      return { ...line, lotId: line.lotId };
    });
    const document = await issueDocument(tx, ctx, order, { docType: "1.1", seriesId: input.seriesId, issuedAt, dueAt: input.dueAt, allocations });
    await tx.wholesaleOrder.update({ where: { id: order.id }, data: { status: "INVOICED" } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "invoice.issue", entityType: "sales_document", entityId: document.id, storeId: order.storeId, warehouseId: order.warehouseId, metadata: { orderId: order.id, deliveryId: delivery.id } });
    return document;
  });
}

async function reverseDocumentStock(tx: Tx, ctx: StockContext, document: { id: string; orgId: string; storeId: string; warehouseId: string; lines: { id: string; genericItemId: string; lotId: string | null; quantityBase: number; costHundredths: number }[] }, source: string, reason: string, at: Date) {
  for (const line of document.lines) {
    if (!line.lotId) throw new WorkflowError("Γραμμή χωρίς παρτίδα δεν αναιρείται αυτόματα");
    const lot = await tx.stockLot.findFirst({ where: { id: line.lotId, orgId: ctx.orgId, genericItemId: line.genericItemId, warehouseId: document.warehouseId } });
    if (!lot) throw new WorkflowError("Η αρχική παρτίδα δεν βρέθηκε για αντίθετη κίνηση");
    await postStockMovement(tx, { orgId: ctx.orgId, storeId: document.storeId, warehouseId: document.warehouseId, documentId: document.id, lineId: `${source}:${line.id}`, genericItemId: line.genericItemId, lotId: line.lotId, quantity: line.quantityBase, source, note: reason, occurredAt: at, actor: actor(ctx) });
  }
}

export async function creditSalesDocument(ctx: StockContext, input: { documentId: string; seriesId: string; reason: string }) {
  try {
    return await stockTransaction(async (tx) => {
      const reason = cleanText(input.reason, "Αιτιολογία πίστωσης", 300, true)!;
      const original = await tx.salesDocument.findFirst({ where: { id: input.documentId, orgId: ctx.orgId }, include: { lines: true, allocations: true } });
      if (!original || original.docType !== "1.1" || original.status !== "ISSUED") throw new WorkflowError("Το αρχικό τιμολόγιο δεν είναι διαθέσιμο για πίστωση");
      await assertStockScope(tx, ctx, { storeId: original.storeId, warehouseId: original.warehouseId, forWrite: true });
      if (original.allocations.length) throw new WorkflowError("Υπάρχουν αντιστοιχίσεις εισπράξεων· απαιτείται πρώτα λογιστική αναίρεσή τους");
      const order = await tx.wholesaleOrder.findFirstOrThrow({ where: { id: original.orderId, orgId: ctx.orgId } });
      const credit = await issueDocument(tx, ctx, order, { docType: "5.1", seriesId: input.seriesId, issuedAt: new Date(), allocations: original.lines.map((line) => ({ ...line, lotId: line.lotId! })), relatedFiscalId: original.fiscalDocumentId });
      await reverseDocumentStock(tx, ctx, credit, "wholesale_credit", reason, credit.issuedAt);
      await tx.salesDocument.update({ where: { id: original.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason } });
      await tx.wholesaleOrder.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "invoice.credit", entityType: "sales_document", entityId: credit.id, storeId: original.storeId, warehouseId: original.warehouseId, reason, metadata: { originalId: original.id } });
      return credit;
    });
  } catch (error) { translate(error); }
}

export async function cancelDeliveryDocument(ctx: StockContext, documentId: string, reason: string) {
  try {
    return await stockTransaction(async (tx) => {
      const cleanReason = cleanText(reason, "Αιτιολογία", 300, true)!;
      const delivery = await tx.salesDocument.findFirst({ where: { id: documentId, orgId: ctx.orgId, docType: "9.3", status: "ISSUED" }, include: { lines: true } });
      if (!delivery) throw new WorkflowError("Το δελτίο παράδοσης δεν βρέθηκε");
      await assertStockScope(tx, ctx, { storeId: delivery.storeId, warehouseId: delivery.warehouseId, forWrite: true });
      if (await tx.salesDocument.count({ where: { orgId: ctx.orgId, orderId: delivery.orderId, docType: { in: ["1.1", "5.1"] }, status: "ISSUED" } })) throw new WorkflowError("Υπάρχει τιμολόγιο ή πιστωτικό· η παράδοση δεν αναιρείται ξεχωριστά");
      await reverseDocumentStock(tx, ctx, delivery, "wholesale_reversal", cleanReason, new Date());
      await tx.salesDocument.update({ where: { id: delivery.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: cleanReason } });
      await tx.wholesaleOrder.update({ where: { id: delivery.orderId }, data: { status: "CONFIRMED", deliveredAt: null } });
      await tx.deliveryStop.updateMany({ where: { orgId: ctx.orgId, orderId: delivery.orderId }, data: { deliveredAt: null } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "wholesale.delivery.reverse", entityType: "sales_document", entityId: delivery.id, storeId: delivery.storeId, warehouseId: delivery.warehouseId, reason: cleanReason });
      return delivery;
    });
  } catch (error) { translate(error); }
}

export type CustomerPaymentInput = { clientKey: string; customerId: string; accountId?: string | null; amountCents: number; paidAt: Date; reference?: string | null; note?: string | null; allocations: { documentId: string; amountCents: number }[] };
export type CanonicalCustomerPaymentRequest = { clientKey: string; customerId: string; accountId: string | null; amountCents: number; paidAt: Date; reference: string | null; note: string | null; allocations: { documentId: string; amountCents: number }[] };

/** Το hash εξαρτάται μόνο από το κανονικοποιημένο λογικό request, όχι από τη σειρά των allocations. */
export function canonicalCustomerPaymentRequest(input: CustomerPaymentInput): CanonicalCustomerPaymentRequest {
  const clientKey = cleanText(input.clientKey, "Κλειδί είσπραξης", 100, true)!;
  if (!validExternalKey(clientKey)) throw new WorkflowError("Άκυρο κλειδί είσπραξης");
  const customerId = cleanText(input.customerId, "Πελάτης", 100, true)!;
  const accountId = cleanText(input.accountId, "Λογαριασμός", 100);
  assertPositiveInt(input.amountCents, "Ποσό είσπραξης");
  validDate(input.paidAt, "ημερομηνία είσπραξης");
  const allocations = input.allocations.map((row) => ({
    documentId: cleanText(row.documentId, "Παραστατικό", 100, true)!,
    amountCents: assertPositiveInt(row.amountCents, "Αντιστοίχιση"),
  })).sort((a, b) => a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0);
  if (new Set(allocations.map((row) => row.documentId)).size !== allocations.length) throw new WorkflowError("Διπλή αντιστοίχιση παραστατικού");
  paymentUnappliedCents(input.amountCents, allocations);
  return { clientKey, customerId, accountId, amountCents: input.amountCents, paidAt: input.paidAt, reference: cleanText(input.reference, "Αναφορά", 100), note: cleanText(input.note, "Σημείωση", 500), allocations };
}

export function customerPaymentRequestHash(orgId: string, request: CanonicalCustomerPaymentRequest) {
  return createHash("sha256").update(JSON.stringify({
    version: 1, orgId, customerId: request.customerId, accountId: request.accountId,
    amountCents: request.amountCents, paidAt: request.paidAt.toISOString(), reference: request.reference,
    note: request.note, allocations: request.allocations,
  })).digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === "P2002") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function existingCustomerPayment(tx: Pick<Tx, "customerPayment">, orgId: string, request: CanonicalCustomerPaymentRequest, requestHash: string) {
  const existing = await tx.customerPayment.findUnique({ where: { orgId_clientKey: { orgId, clientKey: request.clientKey } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) throw new WorkflowError("Το κλειδί είσπραξης χρησιμοποιήθηκε με διαφορετικά δεδομένα");
  return existing;
}

export async function recordCustomerPayment(ctx: StockContext, input: CustomerPaymentInput) {
  const request = canonicalCustomerPaymentRequest(input);
  const requestHash = customerPaymentRequestHash(ctx.orgId, request);
  try {
    return await stockTransaction(async (tx) => {
      // Το lock ανά πελάτη σειριοποιεί και τα allocations· replay και concurrent create δεν υπερβαίνουν το ανεξόφλητο.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`customer-payment:${ctx.orgId}:${request.customerId}`}, 0))) AS lock`;
      await assertParty(tx, ctx.orgId, request.customerId, "customer");
      const account = request.accountId ? await tx.financeAccount.findFirst({ where: { id: request.accountId, orgId: ctx.orgId, active: true } }) : null;
      if (request.accountId && !account) throw new WorkflowError("Ο λογαριασμός είσπραξης δεν βρέθηκε");
      if (account) {
        if (!account.storeId) assertGlobalStockScope(ctx);
        await assertStockScope(tx, ctx, { storeId: account.storeId ?? undefined, forWrite: true });
      }
      const documents = [];
      for (const allocation of request.allocations) {
        const document = await tx.salesDocument.findFirst({ where: { id: allocation.documentId, orgId: ctx.orgId, customerId: request.customerId }, include: { allocations: true } });
        if (!document) throw new WorkflowError("Παραστατικό εκτός πελάτη ή επιχείρησης");
        await assertStockScope(tx, ctx, { storeId: document.storeId, warehouseId: document.warehouseId, forWrite: true });
        documents.push({ allocation, document });
      }
      // Το replay προηγείται του outstanding check: η αρχική είσπραξη έχει ήδη μειώσει το ανεξόφλητο.
      const replay = await existingCustomerPayment(tx, ctx.orgId, request, requestHash);
      if (replay) return replay;
      for (const { allocation, document } of documents) {
        if (allocation.amountCents > outstandingCents(document, document.allocations)) throw new WorkflowError("Η αντιστοίχιση υπερβαίνει το απλήρωτο");
      }
      const payment = await tx.customerPayment.create({ data: {
        orgId: ctx.orgId, customerId: request.customerId, accountId: account?.id ?? null, amountCents: request.amountCents,
        paidAt: request.paidAt, reference: request.reference, note: request.note, clientKey: request.clientKey, requestHash, createdByName: ctx.userName,
        allocations: { create: request.allocations.map((row) => ({ orgId: ctx.orgId, documentId: row.documentId, amountCents: row.amountCents })) },
      } });
      if (account) await tx.financeTransaction.create({ data: { orgId: ctx.orgId, accountId: account.id, storeId: account.storeId, amountCents: request.amountCents, kind: "customer_payment", referenceType: "customer_payment", referenceId: payment.id, occurredAt: request.paidAt, note: request.note, createdByName: ctx.userName } });
      await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "payment.customer", entityType: "customer_payment", entityId: payment.id, storeId: account?.storeId, metadata: { customerId: request.customerId, amountCents: request.amountCents, allocations: request.allocations.length } });
      return payment;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      // Μετά το aborted transaction επιτρέπεται μόνο νέο scoped read· άσχετα unique conflicts ξαναρίχνονται.
      const { db } = await import("./db");
      const replay = await existingCustomerPayment(db, ctx.orgId, request, requestHash);
      if (replay) return replay;
    }
    throw error;
  }
}

export async function createDeliveryRoute(ctx: StockContext, input: { storeId?: string | null; name: string; plannedFor: Date; driverName?: string | null; orderIds: string[] }) {
  const name = cleanText(input.name, "Όνομα δρομολογίου", 120, true)!;
  validDate(input.plannedFor, "ημερομηνία δρομολογίου");
  if (!input.orderIds.length || input.orderIds.length > 100 || new Set(input.orderIds).size !== input.orderIds.length) throw new WorkflowError("Επίλεξε 1–100 μοναδικές παραγγελίες");
  return stockTransaction(async (tx) => {
    if (!input.storeId) assertGlobalStockScope(ctx);
    await assertStockScope(tx, ctx, { storeId: input.storeId ?? undefined, forWrite: true });
    const orders = await tx.wholesaleOrder.findMany({ where: { orgId: ctx.orgId, id: { in: input.orderIds }, status: "CONFIRMED", ...(input.storeId ? { storeId: input.storeId } : {}) } });
    if (orders.length !== input.orderIds.length) throw new WorkflowError("Κάποια παραγγελία δεν είναι επιβεβαιωμένη ή είναι εκτός καταστήματος");
    for (const order of orders) await assertStockScope(tx, ctx, { storeId: order.storeId, warehouseId: order.warehouseId, forWrite: true });
    if (await tx.deliveryStop.count({ where: { orgId: ctx.orgId, orderId: { in: input.orderIds } } })) throw new WorkflowError("Κάποια παραγγελία έχει ήδη δρομολόγιο");
    const route = await tx.deliveryRoute.create({ data: {
      orgId: ctx.orgId, storeId: input.storeId ?? null, name, plannedFor: input.plannedFor,
      driverName: cleanText(input.driverName, "Οδηγός", 120), createdByName: ctx.userName,
      stops: { create: input.orderIds.map((orderId, index) => ({ orgId: ctx.orgId, orderId, position: index + 1 })) },
    }, include: { stops: true } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "delivery.route", entityType: "delivery_route", entityId: route.id, storeId: route.storeId, metadata: { stops: route.stops.length } });
    return route;
  });
}

export async function createB2bAccess(ctx: StockContext, customerId: string, expiresAt?: Date | null) {
  await assertParty((await import("./db")).db, ctx.orgId, customerId, "customer");
  validDate(expiresAt, "λήξη συνδέσμου");
  const token = randomBytes(32).toString("base64url");
  const access = await (await import("./db")).db.b2bAccess.upsert({
    where: { orgId_customerId: { orgId: ctx.orgId, customerId } },
    update: { tokenHash: hashAccessToken(token), expiresAt: expiresAt ?? null, active: true },
    create: { orgId: ctx.orgId, customerId, tokenHash: hashAccessToken(token), expiresAt: expiresAt ?? null },
  });
  return { token, access };
}

export async function b2bContext(token: string) {
  const { db } = await import("./db");
  const access = await db.b2bAccess.findFirst({ where: { tokenHash: hashAccessToken(token), active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { org: true } });
  if (!access || access.org.suspendedAt || access.org.closingAt) throw new WorkflowError("Ο σύνδεσμος πελάτη δεν είναι ενεργός");
  return access;
}

export async function createB2bOrder(token: string, input: { storeId: string; warehouseId: string; neededAt?: Date | null; note?: string | null; externalKey: string; lines: { genericItemId: string; quantityBase: number }[] }) {
  const access = await b2bContext(token);
  const customer = await (await import("./db")).db.party.findFirst({ where: { id: access.customerId, orgId: access.orgId, active: true, roles: { has: "customer" } } });
  if (!customer) throw new WorkflowError("Ο πελάτης δεν είναι ενεργός");
  try {
    return await stockTransaction(async (tx) => {
      const link = await tx.storeWarehouse.findFirst({ where: { storeId: input.storeId, warehouseId: input.warehouseId, store: { orgId: access.orgId, active: true }, warehouse: { orgId: access.orgId, active: true } } });
      if (!link) throw new WorkflowError("Το σημείο παράδοσης δεν είναι διαθέσιμο");
      const lists = await tx.priceList.findMany({ where: {
        orgId: access.orgId, active: true, validFrom: { lte: new Date() },
        AND: [{ OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, { OR: [{ parties: { none: {} } }, { parties: { some: { partyId: access.customerId } } }] }],
      }, include: { parties: true, items: true } });
      const lines: WholesaleLineInput[] = input.lines.map((line) => {
        const price = selectPriceList(lists, access.customerId, line.genericItemId, new Date());
        if (!price) throw new WorkflowError("Κάποιο είδος δεν έχει ενεργή τιμή για τον πελάτη");
        return { ...line, unitPriceCents: price.unitPriceCents, vatRate: price.vatRate };
      });
      return insertOrder(tx, { orgId: access.orgId, userId: null, userName: `B2B: ${customer.name}` }, { ...input, customerId: access.customerId, lines }, "b2b");
    });
  } catch (error) { translate(error); }
}
