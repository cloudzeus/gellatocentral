// Αναφορές της μηχανής κατανάλωσης: θεωρητική έναντι πραγματικής (υπερμερίδα), καταστροφές ανά αιτία,
// γεγονότα προς έλεγχο. Ανά επιχείρηση και αποθήκη, ποσά σε λεπτά, ποσότητες στη βασική μονάδα.
import type { Prisma } from "./generated/prisma/client.ts";
import { stockCostCents } from "./reports.ts";

type Db = Pick<Prisma.TransactionClient, "demandDaily" | "genericItem" | "consumptionEvent">;

export type OverportionRow = {
  genericItemId: string;
  name: string;
  dimension: string;
  theoreticalBase: number;
  actualBase: number;
  overBase: number; // πραγματική − θεωρητική· θετικό = υπερμερίδα (ή διαφορά μέτρησης)
  overPctTenths: number | null; // % × 10 πάνω στη θεωρητική
  overCents: number;
};

/** Καθαρό: η υπερμερίδα σε ποσότητα, % και €. */
export function overportion(input: { theoreticalBase: number; actualBase: number; avgCostHundredths: number; dimension: string }) {
  const overBase = input.actualBase - input.theoreticalBase;
  return {
    overBase,
    overPctTenths: input.theoreticalBase > 0 ? Math.round(overBase * 1000 / input.theoreticalBase) : null,
    overCents: stockCostCents(overBase, input.avgCostHundredths, input.dimension),
  };
}

/** Μόνο για είδη COUNT (γεύσεις): εκεί η πραγματική έρχεται από την απογραφή και η θεωρητική από το ταμείο. */
export async function theoreticalVsActual(db: Db, input: { orgId: string; warehouseId: string; from: Date; to: Date }): Promise<OverportionRow[]> {
  const rows = await db.demandDaily.groupBy({
    by: ["genericItemId"],
    where: { orgId: input.orgId, warehouseId: input.warehouseId, day: { gte: input.from, lte: input.to } },
    _sum: { theoreticalBase: true, consumedBase: true },
  });
  const generics = await db.genericItem.findMany({
    where: { orgId: input.orgId, consumptionSource: "COUNT", id: { in: rows.map((row) => row.genericItemId) } },
    select: { id: true, name: true, avgCostHundredths: true, baseUnit: { select: { dimension: true } } },
  });
  const byId = new Map(rows.map((row) => [row.genericItemId, row._sum]));
  return generics.map((generic) => {
    const sums = byId.get(generic.id)!;
    const theoreticalBase = sums.theoreticalBase ?? 0, actualBase = sums.consumedBase ?? 0;
    return { genericItemId: generic.id, name: generic.name, dimension: generic.baseUnit.dimension, theoreticalBase, actualBase, ...overportion({ theoreticalBase, actualBase, avgCostHundredths: generic.avgCostHundredths, dimension: generic.baseUnit.dimension }) };
  }).sort((a, b) => b.overCents - a.overCents || a.name.localeCompare(b.name, "el"));
}

export async function wasteByReason(db: Db, input: { orgId: string; warehouseId?: string; from: Date; to: Date }) {
  const rows = await db.consumptionEvent.groupBy({
    by: ["reason"],
    where: { orgId: input.orgId, kind: "WASTE", status: "POSTED", day: { gte: input.from, lte: input.to }, ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}) },
    _sum: { costCents: true },
    _count: { _all: true },
  });
  return rows.map((row) => ({ reason: row.reason ?? "OTHER", costCents: row._sum.costCents ?? 0, events: row._count._all })).sort((a, b) => b.costCents - a.costCents);
}

/** «Προϊόντα χωρίς συνταγή» και ελλείμματα αποθέματος: ό,τι πέρασε χωρίς να κινήσει σωστά το απόθεμα. */
export async function consumptionReview(db: Db, input: { orgId: string; take?: number }) {
  return db.consumptionEvent.findMany({
    where: { orgId: input.orgId, status: { in: ["NEEDS_REVIEW", "PENDING_APPROVAL"] } },
    orderBy: { occurredAt: "desc" },
    take: input.take ?? 100,
    select: { id: true, kind: true, status: true, productId: true, genericItemId: true, quantity: true, costCents: true, occurredAt: true, note: true, warehouseId: true, storeId: true },
  });
}
