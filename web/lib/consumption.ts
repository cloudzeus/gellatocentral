// Μία συνάρτηση κατανάλωσης (ενότητα 4α, απόφαση Ε4). Ό,τι φεύγει από το κατάστημα (πώληση, κέρασμα,
// καταστροφή, απογραφή βιτρίνας) και ό,τι επιστρέφει (επιστροφή πελάτη, 11.4) περνά από την consume():
// ένα ConsumptionEvent, κινήσεις αποθέματος μέσω postStockMovement και η ημερήσια ζήτηση (DemandDaily).
import type { Prisma } from "./generated/prisma/client.ts";
import {
  businessDay,
  ConsumptionRuleError,
  countConsumption,
  explodeSale,
  spreadOverDays,
  SALE_LINE_KINDS,
  type ConsumptionKind,
  type ExplodeGeneric,
  type ExplodeRecipe,
  type RecipeLineInput,
  type SaleLineKind,
} from "./consumption-rules.ts";
import { stockCostCents } from "./reports.ts";
import { lockStockKey, lockStockWarehouses, postStockMovement, stockBalance, type StockActor } from "./stock-db.ts";
import { resolveWarehouseId } from "./warehouses.ts";

type Tx = Prisma.TransactionClient;

export type DemandField = "consumedBase" | "theoreticalBase" | "wasteBase" | "wholesaleBase" | "reviewBase";
const DEMAND_FIELDS: readonly DemandField[] = ["consumedBase", "theoreticalBase", "wasteBase", "wholesaleBase", "reviewBase"];

/** Μία γραμμή γεγονότος. quantity > 0 = φεύγει από την αποθήκη, < 0 = μπαίνει. */
export type ConsumeLine = {
  genericItemId: string;
  quantity: number;
  /** false = μόνο ζήτηση, χωρίς κίνηση (θεωρητική κατανάλωση, μοίρασμα σε ημέρες) */
  post?: boolean;
  /** ρητή παρτίδα (απογραφή, αντιλογισμός)· undefined = FEFO στις διαθέσιμες παρτίδες και μετά χωρίς παρτίδα */
  lotId?: string | null;
  unitCostHundredths?: number | null;
  source?: string;
  countId?: string | null;
  countLineId?: string | null;
  demand?: DemandField | null;
  demandQty?: number;
  demandDay?: Date;
};

export type ConsumeEventInput = {
  orgId: string;
  storeId?: string | null;
  warehouseId: string;
  kind: ConsumptionKind;
  reason?: string | null;
  restock?: boolean;
  saleId?: string | null;
  saleLineId?: string | null;
  countLineId?: string | null;
  reversesId?: string | null;
  clientKey?: string | null;
  productId?: string | null;
  genericItemId?: string | null;
  quantity: number;
  occurredAt: Date;
  actor: StockActor;
  note?: string | null;
  /** NEEDS_REVIEW από τον καλούντα (π.χ. χωρίς συνταγή)· PENDING_APPROVAL = χωρίς κινήσεις ως την έγκριση */
  status?: "NEEDS_REVIEW" | "PENDING_APPROVAL";
};

export type ConsumeResult = { id: string; status: string; replayed: boolean; costCents: number; shortfall: number };
type Detail = { genericItemId: string; quantity: number; posted: boolean; shortfall: number; demand: DemandField | null; demandQty: number; day: string };

const SOURCE_BY_KIND: Record<ConsumptionKind, string> = {
  SALE: "consumption", TREAT: "consumption", STAFF: "consumption", COUNT_CONSUMPTION: "consumption",
  WASTE: "waste", CUSTOMER_RETURN: "customer_return", VOID: "consumption",
};

/** Ατομική πρόσθεση στη ζήτηση ημέρας (INSERT … ON CONFLICT): ασφαλές σε ταυτόχρονες πωλήσεις. */
export async function addDemand(tx: Tx, input: { orgId: string; warehouseId: string; genericItemId: string; day: Date; field: DemandField; quantity: number; stockedOut?: boolean }) {
  if (!DEMAND_FIELDS.includes(input.field) || !Number.isSafeInteger(input.quantity)) throw new Error("Άκυρη εγγραφή ζήτησης");
  const col = `"${input.field}"`; // από λευκή λίστα, όχι από τον χρήστη
  const stocked = input.stockedOut === undefined ? null : input.stockedOut;
  await tx.$executeRawUnsafe(
    `INSERT INTO "DemandDaily" ("orgId","warehouseId","genericItemId","day",${col},"stockedOut","updatedAt")
     VALUES ($1,$2,$3,$4::date,$5,COALESCE($6::boolean,false),now())
     ON CONFLICT ("orgId","warehouseId","genericItemId","day")
     DO UPDATE SET ${col} = "DemandDaily".${col} + EXCLUDED.${col}, "stockedOut" = COALESCE($6::boolean, "DemandDaily"."stockedOut"), "updatedAt" = now()`,
    input.orgId, input.warehouseId, input.genericItemId, input.day.toISOString().slice(0, 10), input.quantity, stocked,
  );
}

async function existingEvent(tx: Tx, input: ConsumeEventInput) {
  if (input.saleLineId) return tx.consumptionEvent.findUnique({ where: { saleLineId_kind: { saleLineId: input.saleLineId, kind: input.kind } } });
  if (input.countLineId) return tx.consumptionEvent.findUnique({ where: { countLineId_kind: { countLineId: input.countLineId, kind: input.kind } } });
  if (input.clientKey) return tx.consumptionEvent.findUnique({ where: { orgId_clientKey: { orgId: input.orgId, clientKey: input.clientKey } } });
  return null;
}

/** FEFO στις διαθέσιμες παρτίδες, μετά στο απόθεμα χωρίς παρτίδα· ό,τι λείπει επιστρέφεται, δεν πετάει λάθος. */
async function allocateOutflow(tx: Tx, orgId: string, warehouseId: string, genericItemId: string, quantity: number) {
  const lots = await tx.stockLot.findMany({
    where: { orgId, genericItemId, warehouseId, holdStatus: { in: ["AVAILABLE", "RELEASED"] } },
    select: { id: true, expiresAt: true },
  });
  const keys = [...lots.map((lot) => lot.id), null];
  for (const lotId of [...keys].sort((a, b) => String(a).localeCompare(String(b)))) await lockStockKey(tx, { orgId, warehouseId, genericItemId, lotId });
  const sums = lots.length ? await tx.stockMovement.groupBy({ by: ["lotId"], where: { orgId, warehouseId, genericItemId, lotId: { in: lots.map((lot) => lot.id) } }, _sum: { quantity: true } }) : [];
  const byLot = new Map(sums.map((row) => [row.lotId, row._sum.quantity ?? 0]));
  const ordered = [...lots].sort((a, b) => ((a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity)) || a.id.localeCompare(b.id));
  const parts: { lotId: string | null; quantity: number }[] = [];
  let remaining = quantity;
  for (const lot of ordered) {
    const available = byLot.get(lot.id) ?? 0;
    if (remaining <= 0 || available <= 0) continue;
    const take = Math.min(available, remaining);
    parts.push({ lotId: lot.id, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) {
    const loose = await stockBalance(tx, { orgId, warehouseId, genericItemId, lotId: null });
    const take = Math.min(Math.max(0, loose), remaining);
    if (take > 0) parts.push({ lotId: null, quantity: take });
    remaining -= take;
  }
  return { parts, shortfall: remaining };
}

/**
 * Η συνάρτηση κατανάλωσης. Idempotent στο saleLineId/countLineId/clientKey (+ kind). Ποτέ δεν γράφει
 * αρνητικό απόθεμα: ό,τι λείπει καταγράφεται ως έλλειμμα και το γεγονός πάει σε NEEDS_REVIEW.
 */
export async function consume(tx: Tx, input: ConsumeEventInput, lines: readonly ConsumeLine[]): Promise<ConsumeResult> {
  if (!Number.isSafeInteger(input.quantity)) throw new ConsumptionRuleError("INVALID_QUANTITY", "Άκυρη ποσότητα γεγονότος");
  const found = await existingEvent(tx, input);
  if (found) return { id: found.id, status: found.status, replayed: true, costCents: found.costCents, shortfall: 0 };
  const day = businessDay(input.occurredAt);
  const event = await tx.consumptionEvent.create({
    data: {
      orgId: input.orgId, storeId: input.storeId ?? null, warehouseId: input.warehouseId, kind: input.kind, reason: input.reason ?? null,
      restock: input.restock ?? false, saleId: input.saleId ?? null, saleLineId: input.saleLineId ?? null, countLineId: input.countLineId ?? null,
      reversesId: input.reversesId ?? null, clientKey: input.clientKey ?? null, productId: input.productId ?? null, genericItemId: input.genericItemId ?? null,
      quantity: input.quantity, occurredAt: input.occurredAt, day, status: input.status ?? "POSTED", note: input.note ?? null, createdByName: input.actor.name,
    },
  });
  if (input.status === "PENDING_APPROVAL") return { id: event.id, status: event.status, replayed: false, costCents: 0, shortfall: 0 };
  return applyLines(tx, { ...input, id: event.id, day }, lines);
}

async function applyLines(tx: Tx, event: ConsumeEventInput & { id: string; day: Date }, lines: readonly ConsumeLine[]): Promise<ConsumeResult> {
  const { orgId, warehouseId } = event;
  const generics = new Map((await tx.genericItem.findMany({
    where: { orgId, id: { in: [...new Set(lines.map((line) => line.genericItemId))] } },
    select: { id: true, trackStock: true, avgCostHundredths: true, baseUnit: { select: { dimension: true } } },
  })).map((generic) => [generic.id, generic]));
  if (lines.some((line) => line.post !== false)) await lockStockWarehouses(tx, orgId, [warehouseId]);
  const detail: Detail[] = [];
  let costCents = 0;
  let shortfall = 0;
  for (const line of lines) {
    const generic = generics.get(line.genericItemId);
    if (!generic || !Number.isSafeInteger(line.quantity) || line.quantity === 0) continue;
    const post = line.post !== false && generic.trackStock;
    let missing = 0;
    if (post) {
      const base = { orgId, warehouseId, genericItemId: generic.id, storeId: event.storeId ?? null, source: line.source ?? SOURCE_BY_KIND[event.kind], countId: line.countId ?? null, countLineId: line.countLineId ?? null, note: event.note ?? null, occurredAt: event.occurredAt, actor: event.actor };
      const parts = line.lotId !== undefined || line.quantity < 0
        ? { parts: [{ lotId: line.lotId ?? null, quantity: line.quantity }], shortfall: 0 }
        : await allocateOutflow(tx, orgId, warehouseId, generic.id, line.quantity);
      for (const part of parts.parts) {
        const movement = await postStockMovement(tx, { ...base, lotId: part.lotId, quantity: -part.quantity, unitCostHundredths: line.unitCostHundredths ?? undefined, consumptionEventId: event.id });
        costCents += stockCostCents(part.quantity, movement.unitCostHundredths ?? 0, generic.baseUnit.dimension);
      }
      missing = parts.shortfall;
      if (missing) costCents += stockCostCents(missing, generic.avgCostHundredths, generic.baseUnit.dimension);
      shortfall += missing;
    }
    const demandQty = line.demandQty ?? line.quantity;
    const demandDay = line.demandDay ?? event.day;
    if (line.demand && demandQty) await addDemand(tx, { orgId, warehouseId, genericItemId: generic.id, day: demandDay, field: line.demand, quantity: demandQty });
    detail.push({ genericItemId: generic.id, quantity: line.quantity, posted: post, shortfall: missing, demand: line.demand ?? null, demandQty, day: demandDay.toISOString().slice(0, 10) });
  }
  const status = event.status ?? (shortfall ? "NEEDS_REVIEW" : "POSTED");
  const note = shortfall && !event.note ? "Το απόθεμα δεν έφτανε· η διαφορά θέλει έλεγχο" : event.note ?? null;
  await tx.consumptionEvent.update({ where: { id: event.id }, data: { status, costCents, detail: detail as unknown as Prisma.InputJsonValue, note } });
  return { id: event.id, status, replayed: false, costCents, shortfall };
}

// ── Πώληση ──────────────────────────────────────────────────────────────────

type ExplodeContext = { generics: Map<string, ExplodeGeneric>; recipesByOutput: Map<string, ExplodeRecipe> };

export async function explodeContext(tx: Tx, orgId: string): Promise<ExplodeContext> {
  const rows = await tx.genericItem.findMany({
    where: { orgId },
    select: { id: true, consumptionSource: true, madeToOrder: true, trackStock: true, gramsPerPiece: true, baseUnit: { select: { dimension: true } } },
  });
  const generics = new Map(rows.map((row) => [row.id, { id: row.id, consumptionSource: row.consumptionSource, madeToOrder: row.madeToOrder, trackStock: row.trackStock, gramsPerPiece: row.gramsPerPiece, dimension: row.baseUnit.dimension }]));
  const made = rows.filter((row) => row.madeToOrder).map((row) => row.id);
  const recipes = made.length ? await tx.recipe.findMany({ where: { orgId, active: true, outputGenericItemId: { in: made } }, select: { id: true, batchGrams: true, outputGenericItemId: true, items: { select: { genericItemId: true, grams: true } } } }) : [];
  return { generics, recipesByOutput: new Map(recipes.map((recipe) => [recipe.outputGenericItemId!, recipe])) };
}

/** Η συνταγή πώλησης που ίσχυε τη στιγμή της πώλησης (μεγαλύτερο validFrom ≤ at). */
export async function activeSalesRecipes(tx: Tx, orgId: string, productIds: readonly string[], optionIds: readonly string[], at: Date) {
  const rows = await tx.salesRecipe.findMany({
    where: { orgId, validFrom: { lte: at }, OR: [{ productId: { in: [...productIds] } }, { modifierOptionId: { in: [...optionIds] } }] },
    include: { lines: { select: { genericItemId: true, quantityBase: true } } },
    orderBy: [{ validFrom: "desc" }, { version: "desc" }],
  });
  const product = new Map<string, RecipeLineInput[]>();
  const option = new Map<string, RecipeLineInput[]>();
  for (const row of rows) {
    if (row.productId && !product.has(row.productId)) product.set(row.productId, row.lines);
    if (row.modifierOptionId && !option.has(row.modifierOptionId)) option.set(row.modifierOptionId, row.lines);
  }
  return { product, option };
}

/** Οι επιλογές γραμμής: από το id (νέες γραμμές) ή από το όνομα μέσα στις ομάδες του προϊόντος (παλιές). */
async function lineOptionIds(tx: Tx, lines: readonly { productId: string; options: Prisma.JsonValue }[]) {
  const byLine = lines.map((line) => (Array.isArray(line.options) ? line.options : []) as { id?: string; name?: string }[]);
  const needName = lines.filter((_, i) => byLine[i]!.some((option) => !option.id)).map((line) => line.productId);
  const named = needName.length ? await tx.productModifierGroup.findMany({ where: { productId: { in: needName } }, select: { productId: true, group: { select: { options: { select: { id: true, name: true } } } } } }) : [];
  return lines.map((line, i) => byLine[i]!.flatMap((option) => {
    if (option.id) return [option.id];
    const hit = named.filter((row) => row.productId === line.productId).flatMap((row) => row.group.options).find((candidate) => candidate.name === option.name);
    return hit ? [hit.id] : [];
  }));
}

/**
 * Κατανάλωση ολοκληρωμένης πώλησης: τα είδη SALE βγαίνουν από την αποθήκη, τα είδη COUNT γράφουν μόνο
 * θεωρητική κατανάλωση. Χωρίς συνταγή → NEEDS_REVIEW (λίστα «Προϊόντα χωρίς συνταγή»).
 */
export async function consumeSale(tx: Tx, input: { orgId: string; saleId: string; actor?: StockActor }) {
  const sale = await tx.sale.findFirst({ where: { id: input.saleId, orgId: input.orgId, status: "COMPLETED" }, include: { lines: { orderBy: { id: "asc" } } } });
  if (!sale?.lines.length) return [];
  const occurredAt = sale.issuedAt ?? new Date();
  const warehouseId = await resolveWarehouseId(tx, { orgId: input.orgId, storeId: sale.storeId, deviceId: sale.deviceId });
  const optionIds = await lineOptionIds(tx, sale.lines);
  const recipes = await activeSalesRecipes(tx, input.orgId, sale.lines.map((line) => line.productId), optionIds.flat(), occurredAt);
  const context = await explodeContext(tx, input.orgId);
  const actor = input.actor ?? { id: null, name: "Ταμείο" };
  const results: ConsumeResult[] = [];
  for (const [i, line] of sale.lines.entries()) {
    const kind: SaleLineKind = (SALE_LINE_KINDS as readonly string[]).includes(line.kind) ? line.kind as SaleLineKind : "SALE";
    const productLines = recipes.product.get(line.productId);
    const optionLines = optionIds[i]!.flatMap((id) => recipes.option.get(id) ?? []);
    const base = { orgId: input.orgId, storeId: sale.storeId, warehouseId, kind, saleId: sale.id, saleLineId: line.id, productId: line.productId, quantity: line.quantity, occurredAt, actor };
    let lines: ConsumeLine[] = [];
    let problem: string | null = productLines ? null : "Το προϊόν δεν έχει συνταγή πώλησης";
    try {
      lines = explodeSale([...(productLines ?? []), ...optionLines], line.quantity, context.generics, context.recipesByOutput)
        .map((req) => ({ genericItemId: req.genericItemId, quantity: req.quantity, post: !req.theoretical, demand: req.theoretical ? "theoreticalBase" : "consumedBase" }));
    } catch (error) {
      if (!(error instanceof ConsumptionRuleError)) throw error;
      problem = error.message;
      lines = [];
    }
    results.push(await consume(tx, { ...base, status: problem ? "NEEDS_REVIEW" : undefined, note: problem }, lines));
  }
  return results;
}

/** Το ίδιο, μέσα σε savepoint: η αποτυχία κατανάλωσης δεν μπλοκάρει ποτέ την πώληση. */
export async function consumeSaleSafely(tx: Tx, input: { orgId: string; saleId: string }) {
  await tx.$executeRawUnsafe("SAVEPOINT consume_sale");
  try {
    await consumeSale(tx, input);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT consume_sale");
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT consume_sale");
    console.error("κατανάλωση πώλησης:", input.saleId, error instanceof Error ? error.message : error);
  }
}

/**
 * Αντιλογισμός πώλησης (11.4): αντίθετες κινήσεις στις ίδιες παρτίδες με το ίδιο ιστορικό κόστος,
 * και αφαίρεση από τη ζήτηση της αρχικής ημέρας. Idempotent ανά γραμμή.
 */
export async function reverseSale(tx: Tx, input: { orgId: string; saleId: string; occurredAt?: Date; actor?: StockActor }) {
  const events = await tx.consumptionEvent.findMany({
    where: { orgId: input.orgId, saleId: input.saleId, kind: { in: [...SALE_LINE_KINDS] } },
    include: { movements: { select: { genericItemId: true, lotId: true, quantity: true, unitCostHundredths: true } } },
    orderBy: { id: "asc" },
  });
  const results: ConsumeResult[] = [];
  for (const original of events) {
    const detail = (Array.isArray(original.detail) ? original.detail : []) as Detail[];
    const lines: ConsumeLine[] = [
      ...original.movements.flatMap((movement) => movement.genericItemId ? [{ genericItemId: movement.genericItemId, quantity: movement.quantity, lotId: movement.lotId, unitCostHundredths: movement.unitCostHundredths, demand: null }] : []),
      ...detail.filter((row) => row.demand && row.demandQty).map((row) => ({ genericItemId: row.genericItemId, quantity: -row.demandQty, post: false, demand: row.demand, demandDay: new Date(`${row.day}T00:00:00.000Z`) })),
    ];
    results.push(await consume(tx, {
      orgId: input.orgId, storeId: original.storeId, warehouseId: original.warehouseId, kind: "VOID", saleId: original.saleId, saleLineId: original.saleLineId,
      reversesId: original.id, productId: original.productId, quantity: -original.quantity, occurredAt: input.occurredAt ?? new Date(), actor: input.actor ?? { id: null, name: "Πιστωτικό 11.4" },
    }, lines));
  }
  return results;
}

export async function reverseSaleSafely(tx: Tx, input: { orgId: string; saleId: string }) {
  await tx.$executeRawUnsafe("SAVEPOINT reverse_sale");
  try {
    await reverseSale(tx, input);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT reverse_sale");
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT reverse_sale");
    console.error("αντιλογισμός κατανάλωσης:", input.saleId, error instanceof Error ? error.message : error);
  }
}

// ── Καταστροφή και επιστροφή πελάτη ─────────────────────────────────────────

/** shortcut: σταθερό όριο έγκρισης καταστροφής (50 €)· όταν χρειαστεί, γίνεται ρύθμιση της επιχείρησης. */
export const WASTE_APPROVAL_CENTS = 5_000;

export type WasteInput = {
  orgId: string;
  storeId?: string | null;
  warehouseId: string;
  genericItemId: string;
  quantity: number;
  reason: string;
  lotId?: string | null;
  clientKey: string;
  note?: string | null;
  occurredAt?: Date;
  actor: StockActor;
  /** ο χρήστης έχει δικαίωμα έγκρισης· αλλιώς πάνω από το όριο μένει σε αναμονή */
  canApprove: boolean;
};

export async function recordWaste(tx: Tx, input: WasteInput): Promise<ConsumeResult> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new ConsumptionRuleError("INVALID_QUANTITY", "Η ποσότητα καταστροφής είναι θετικός ακέραιος");
  const generic = await tx.genericItem.findFirst({ where: { id: input.genericItemId, orgId: input.orgId }, select: { avgCostHundredths: true, baseUnit: { select: { dimension: true } } } });
  if (!generic) throw new ConsumptionRuleError("INVALID_QUANTITY", "Το είδος δεν βρέθηκε");
  const value = stockCostCents(input.quantity, generic.avgCostHundredths, generic.baseUnit.dimension);
  const pending = !input.canApprove && value > WASTE_APPROVAL_CENTS;
  return consume(tx, {
    orgId: input.orgId, storeId: input.storeId, warehouseId: input.warehouseId, kind: "WASTE", reason: input.reason, clientKey: input.clientKey,
    genericItemId: input.genericItemId, quantity: input.quantity, occurredAt: input.occurredAt ?? new Date(), actor: input.actor, note: input.note,
    status: pending ? "PENDING_APPROVAL" : undefined,
  }, [{ genericItemId: input.genericItemId, quantity: input.quantity, lotId: input.lotId, demand: "wasteBase" }]);
}

/** Έγκριση καταστροφής σε αναμονή: τότε γράφονται κινήσεις και ζήτηση. */
export async function approveWaste(tx: Tx, input: { orgId: string; eventId: string; actor: StockActor }): Promise<ConsumeResult> {
  const event = await tx.consumptionEvent.findFirst({ where: { id: input.eventId, orgId: input.orgId, kind: "WASTE" } });
  if (!event) throw new ConsumptionRuleError("INVALID_QUANTITY", "Η καταστροφή δεν βρέθηκε");
  if (event.status !== "PENDING_APPROVAL") return { id: event.id, status: event.status, replayed: true, costCents: event.costCents, shortfall: 0 };
  const claimed = await tx.consumptionEvent.updateMany({ where: { id: event.id, status: "PENDING_APPROVAL" }, data: { status: "POSTED", note: `${event.note ? `${event.note} · ` : ""}Εγκρίθηκε από ${input.actor.name}` } });
  if (claimed.count !== 1) return { id: event.id, status: "POSTED", replayed: true, costCents: event.costCents, shortfall: 0 };
  return applyLines(tx, {
    orgId: event.orgId, storeId: event.storeId, warehouseId: event.warehouseId, kind: "WASTE", quantity: event.quantity, occurredAt: event.occurredAt,
    actor: input.actor, note: `Εγκρίθηκε από ${input.actor.name}`, id: event.id, day: event.day,
  }, [{ genericItemId: event.genericItemId!, quantity: event.quantity, demand: "wasteBase" }]);
}

export type CustomerReturnInput = {
  orgId: string;
  storeId: string;
  warehouseId?: string | null;
  deviceId?: string | null;
  productId: string;
  optionIds?: readonly string[];
  quantity: number;
  restock: boolean;
  clientKey: string;
  reason?: string | null;
  occurredAt?: Date;
  actor: StockActor;
};

/**
 * Επιστροφή από πελάτη: τα είδη της συνταγής ξαναμπαίνουν στο απόθεμα και φεύγουν από τη ζήτηση.
 * Χωρίς επανεισαγωγή (restock = false) γράφεται ταυτόχρονα καταστροφή, ώστε να φαίνεται στη φύρα.
 */
export async function customerReturn(tx: Tx, input: CustomerReturnInput) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new ConsumptionRuleError("INVALID_QUANTITY", "Η ποσότητα επιστροφής είναι θετικός ακέραιος");
  const occurredAt = input.occurredAt ?? new Date();
  const warehouseId = await resolveWarehouseId(tx, { orgId: input.orgId, storeId: input.storeId, deviceId: input.deviceId, requestedWarehouseId: input.warehouseId });
  const recipes = await activeSalesRecipes(tx, input.orgId, [input.productId], input.optionIds ?? [], occurredAt);
  const context = await explodeContext(tx, input.orgId);
  const reqs = explodeSale([...(recipes.product.get(input.productId) ?? []), ...(input.optionIds ?? []).flatMap((id) => recipes.option.get(id) ?? [])], input.quantity, context.generics, context.recipesByOutput);
  const base = { orgId: input.orgId, storeId: input.storeId, warehouseId, productId: input.productId, quantity: -input.quantity, occurredAt, actor: input.actor, reason: input.reason ?? null };
  const back = await consume(tx, { ...base, kind: "CUSTOMER_RETURN", restock: input.restock, clientKey: input.clientKey, status: reqs.length ? undefined : "NEEDS_REVIEW", note: reqs.length ? null : "Το προϊόν δεν έχει συνταγή πώλησης" },
    reqs.map((req) => req.theoretical
      ? { genericItemId: req.genericItemId, quantity: -req.quantity, post: false, demand: "theoreticalBase" as const }
      : { genericItemId: req.genericItemId, quantity: -req.quantity, lotId: null, demand: "consumedBase" as const }));
  if (input.restock || back.replayed) return { returned: back, waste: null };
  const stocked = reqs.filter((req) => !req.theoretical);
  const waste = stocked.length ? await consume(tx, { ...base, kind: "WASTE", reason: input.reason ?? "QUALITY", quantity: input.quantity, clientKey: `${input.clientKey}:waste`, note: "Επιστροφή πελάτη χωρίς επανεισαγωγή" },
    stocked.map((req) => ({ genericItemId: req.genericItemId, quantity: req.quantity, lotId: null, demand: "wasteBase" as const }))) : null;
  return { returned: back, waste };
}

// ── Ημερήσια απογραφή βιτρίνας ──────────────────────────────────────────────

/** Πόσες ημέρες πίσω καλύπτει το πολύ μια απογραφή όταν λείπουν οι ενδιάμεσες. */
export const MAX_COUNT_GAP_DAYS = 31;

export type CountLineInput = {
  id: string;
  genericItemId: string;
  lotId: string | null;
  expectedQty: number;
  actualQty: number;
  wasteQty: number;
  reason: string | null;
};

/**
 * Ημέρες που καλύπτει η απογραφή για το είδος: από την επόμενη της προηγούμενης οριστικής ως τη σημερινή,
 * χωρίς ημέρες κλειστού καταστήματος. Τα βάρη είναι η θεωρητική κατανάλωση του ταμείου κάθε ημέρας.
 */
async function coveredDays(tx: Tx, input: { orgId: string; storeId: string | null; warehouseId: string; genericItemId: string; countedOn: Date; countId: string }) {
  const previous = await tx.stockCount.findFirst({
    where: { orgId: input.orgId, warehouseId: input.warehouseId, status: "FINALIZED", countedOn: { lt: input.countedOn }, NOT: { id: input.countId }, lines: { some: { genericItemId: input.genericItemId } } },
    orderBy: { countedOn: "desc" },
    select: { countedOn: true, finalizedAt: true },
  });
  const first = previous ? new Date(Math.max(previous.countedOn.getTime() + 86_400_000, input.countedOn.getTime() - (MAX_COUNT_GAP_DAYS - 1) * 86_400_000)) : input.countedOn;
  let days: Date[] = [];
  for (let day = first; day <= input.countedOn; day = new Date(day.getTime() + 86_400_000)) days.push(day);
  if (input.storeId && days.length > 1) {
    const pauses = await tx.storePause.findMany({ where: { orgId: input.orgId, storeId: input.storeId, startedAt: { lte: new Date(input.countedOn.getTime() + 86_400_000) }, OR: [{ endedAt: null }, { endedAt: { gte: first } }] }, select: { startedAt: true, endedAt: true } });
    // κλειστή ημέρα = όλο το 24ωρο μέσα σε παύση· η ημέρα της απογραφής μένει πάντα
    const closed = (day: Date) => pauses.some((pause) => pause.startedAt <= day && (!pause.endedAt || pause.endedAt >= new Date(day.getTime() + 86_400_000)));
    days = days.filter((day) => day.getTime() === input.countedOn.getTime() || !closed(day));
  }
  const weights = await tx.demandDaily.findMany({ where: { orgId: input.orgId, warehouseId: input.warehouseId, genericItemId: input.genericItemId, day: { in: days } }, select: { day: true, theoreticalBase: true } });
  const weightByDay = new Map(weights.map((row) => [row.day.toISOString().slice(0, 10), row.theoreticalBase]));
  return { previous, days: days.map((day) => ({ day: day.toISOString().slice(0, 10), weight: weightByDay.get(day.toISOString().slice(0, 10)) ?? 0 })) };
}

/**
 * Μία γραμμή οριστικοποιημένης απογραφής. Πεταμένα → καταστροφή. Είδος COUNT: η υπόλοιπη διαφορά είναι
 * κατανάλωση (μοιρασμένη στις ημέρες που κάλυψε η απογραφή) ή, αν βγει αρνητική, έλεγχος εκτός πρόβλεψης.
 * Είδος SALE: η υπόλοιπη διαφορά μένει διόρθωση απογραφής με αιτία, όπως πριν.
 */
export async function consumeCountLine(tx: Tx, input: { orgId: string; storeId: string | null; warehouseId: string; countId: string; countedOn: Date; snapshotAt: Date; occurredAt: Date; actor: StockActor; consumptionSource: string; line: CountLineInput }) {
  const { line } = input;
  const isCount = input.consumptionSource === "COUNT";
  const { consumption, waste, needsReview, stockedOut } = countConsumptionChecked(line);
  const event = { orgId: input.orgId, storeId: input.storeId, warehouseId: input.warehouseId, countLineId: line.id, genericItemId: line.genericItemId, occurredAt: input.occurredAt, actor: input.actor };
  if (waste > 0) {
    await consume(tx, { ...event, kind: "WASTE", reason: "EXPIRED", quantity: waste, note: "Πεταμένα στην απογραφή" },
      [{ genericItemId: line.genericItemId, quantity: waste, lotId: line.lotId, countId: input.countId, demand: "wasteBase", demandDay: input.countedOn }]);
  }
  let inflowQty = 0;
  if (!isCount) {
    if (consumption !== 0) await postStockMovement(tx, { orgId: input.orgId, warehouseId: input.warehouseId, genericItemId: line.genericItemId, lotId: line.lotId, storeId: input.storeId, quantity: -consumption, source: "count", countId: input.countId, countLineId: line.id, note: line.reason, occurredAt: input.occurredAt, actor: input.actor });
  } else {
    const covered = await coveredDays(tx, { ...input, genericItemId: line.genericItemId });
    if (covered.previous?.finalizedAt) {
      const inflow = await tx.stockMovement.aggregate({ where: { orgId: input.orgId, warehouseId: input.warehouseId, genericItemId: line.genericItemId, lotId: line.lotId, quantity: { gt: 0 }, source: { notIn: ["count", "consumption", "waste"] }, recordedAt: { gt: covered.previous.finalizedAt, lte: input.snapshotAt } }, _sum: { quantity: true } });
      inflowQty = inflow._sum.quantity ?? 0;
    }
    if (consumption > 0) {
      const spread = spreadOverDays(consumption, covered.days);
      await consume(tx, { ...event, kind: "COUNT_CONSUMPTION", quantity: consumption, note: line.reason }, [
        { genericItemId: line.genericItemId, quantity: consumption, lotId: line.lotId, countId: input.countId, countLineId: line.id, demand: null },
        ...[...spread].filter(([, qty]) => qty).map(([day, qty]) => ({ genericItemId: line.genericItemId, quantity: qty, post: false, demand: "consumedBase" as const, demandDay: new Date(`${day}T00:00:00.000Z`) })),
      ]);
    } else if (needsReview) {
      await consume(tx, { ...event, kind: "COUNT_CONSUMPTION", quantity: consumption, status: "NEEDS_REVIEW", note: line.reason ?? "Αρνητική κατανάλωση: πιθανή εισαγωγή που δεν καταχωρήθηκε" },
        [{ genericItemId: line.genericItemId, quantity: consumption, lotId: line.lotId, countId: input.countId, countLineId: line.id, source: "count", demand: "reviewBase", demandQty: -consumption, demandDay: input.countedOn }]);
    }
    await addDemand(tx, { orgId: input.orgId, warehouseId: input.warehouseId, genericItemId: line.genericItemId, day: input.countedOn, field: "consumedBase", quantity: 0, stockedOut });
  }
  await tx.stockCountLine.update({ where: { id: line.id }, data: { consumptionQty: isCount ? consumption : null, inflowQty } });
  return { consumption, waste, needsReview: isCount && needsReview, stockedOut };
}

function countConsumptionChecked(line: CountLineInput) {
  return countConsumption({ expectedQty: line.expectedQty, actualQty: line.actualQty, wasteQty: line.wasteQty });
}

/**
 * Διόρθωση οριστικοποιημένης απογραφής (όπως το correct_shop_count της παλιάς): οι κινήσεις είναι
 * append-only, άρα γράφεται η διαφορά νέας − παλιάς κατανάλωσης/φύρας στο ίδιο γεγονός και στη ζήτηση.
 * shortcut: η διαφορά της ζήτησης πάει όλη στην ημέρα της απογραφής, όχι ξανά μοιρασμένη στις ημέρες που κάλυψε.
 */
export async function correctCountLine(tx: Tx, input: { orgId: string; countLineId: string; actualQty: number; wasteQty: number; actor: StockActor; reason: string }) {
  const line = await tx.stockCountLine.findFirst({ where: { id: input.countLineId, orgId: input.orgId, count: { status: "FINALIZED" } }, include: { count: true, genericItem: { select: { consumptionSource: true } } } });
  if (!line || line.actualQty === null) throw new ConsumptionRuleError("INVALID_QUANTITY", "Η γραμμή απογραφής δεν βρέθηκε ή δεν είναι οριστική");
  if (line.genericItem.consumptionSource !== "COUNT") throw new ConsumptionRuleError("INVALID_QUANTITY", "Διορθώνονται μόνο είδη που μετριούνται με απογραφή");
  const before = countConsumption({ expectedQty: line.expectedQty, actualQty: line.actualQty, wasteQty: line.wasteQty });
  const after = countConsumption({ expectedQty: line.expectedQty, actualQty: input.actualQty, wasteQty: input.wasteQty });
  const { count } = line;
  const occurredAt = new Date();
  const base = { orgId: input.orgId, storeId: count.storeId, warehouseId: count.warehouseId, genericItemId: line.genericItemId, occurredAt, actor: input.actor, note: input.reason };
  const deltaWaste = after.waste - before.waste;
  if (deltaWaste) {
    const event = await tx.consumptionEvent.findUnique({ where: { countLineId_kind: { countLineId: line.id, kind: "WASTE" } } })
      ?? await tx.consumptionEvent.create({ data: { orgId: input.orgId, storeId: count.storeId, warehouseId: count.warehouseId, kind: "WASTE", reason: "EXPIRED", countLineId: line.id, genericItemId: line.genericItemId, quantity: 0, occurredAt, day: count.countedOn, createdByName: input.actor.name } });
    await postStockMovement(tx, { ...base, lotId: line.lotId, quantity: -deltaWaste, source: "waste", countId: count.id, consumptionEventId: event.id });
    await tx.consumptionEvent.update({ where: { id: event.id }, data: { quantity: after.waste } });
    await addDemand(tx, { orgId: input.orgId, warehouseId: count.warehouseId, genericItemId: line.genericItemId, day: count.countedOn, field: "wasteBase", quantity: deltaWaste });
  }
  const deltaConsumption = after.consumption - before.consumption;
  if (deltaConsumption) {
    const event = await tx.consumptionEvent.findUnique({ where: { countLineId_kind: { countLineId: line.id, kind: "COUNT_CONSUMPTION" } } })
      ?? await tx.consumptionEvent.create({ data: { orgId: input.orgId, storeId: count.storeId, warehouseId: count.warehouseId, kind: "COUNT_CONSUMPTION", countLineId: line.id, genericItemId: line.genericItemId, quantity: 0, occurredAt, day: count.countedOn, createdByName: input.actor.name } });
    await postStockMovement(tx, { ...base, lotId: line.lotId, quantity: -deltaConsumption, source: "consumption", countId: count.id, consumptionEventId: event.id });
    await tx.consumptionEvent.update({ where: { id: event.id }, data: { quantity: after.consumption, status: after.needsReview ? "NEEDS_REVIEW" : "POSTED" } });
    // η ζήτηση κρατά μόνο θετική κατανάλωση· η αρνητική πάει στον έλεγχο
    const demandBefore = Math.max(0, before.consumption), demandAfter = Math.max(0, after.consumption);
    const reviewBefore = Math.max(0, -before.consumption), reviewAfter = Math.max(0, -after.consumption);
    if (demandAfter !== demandBefore) await addDemand(tx, { orgId: input.orgId, warehouseId: count.warehouseId, genericItemId: line.genericItemId, day: count.countedOn, field: "consumedBase", quantity: demandAfter - demandBefore });
    if (reviewAfter !== reviewBefore) await addDemand(tx, { orgId: input.orgId, warehouseId: count.warehouseId, genericItemId: line.genericItemId, day: count.countedOn, field: "reviewBase", quantity: reviewAfter - reviewBefore });
  }
  await addDemand(tx, { orgId: input.orgId, warehouseId: count.warehouseId, genericItemId: line.genericItemId, day: count.countedOn, field: "consumedBase", quantity: 0, stockedOut: after.stockedOut });
  await tx.stockCountLine.update({ where: { id: line.id }, data: { actualQty: input.actualQty, wasteQty: input.wasteQty, differenceQty: input.actualQty - line.expectedQty, consumptionQty: after.consumption, reason: input.reason } });
  return { before, after };
}
