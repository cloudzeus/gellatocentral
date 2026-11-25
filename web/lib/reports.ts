// Καθαρά aggregates αναφορών: ημερομηνίες Αθήνας, πρόσημα πιστωτικών και κλίμακες κόστους αποθέματος.
import { athensBusinessRange } from "./finance.ts";
import { stockCostScale } from "./units.ts";

export type ReportPeriod = { fromAt: Date; toAt: Date; from: string; to: string };

export function reportPeriod(from: string, to: string, maximumDays = 366): ReportPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Οι ημερομηνίες πρέπει να είναι YYYY-MM-DD");
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (fromDate.toISOString().slice(0, 10) !== from || toDate.toISOString().slice(0, 10) !== to) throw new Error("Μη έγκυρη ημερομηνία αναφοράς");
  const start = athensBusinessRange(fromDate);
  const end = athensBusinessRange(new Date(`${to}T00:00:00.000Z`));
  if (start.fromAt >= end.toAt || end.toAt.getTime() - start.fromAt.getTime() > maximumDays * 86_400_000) throw new Error(`Άκυρη περίοδος αναφοράς (έως ${maximumDays} ημέρες)`);
  return { fromAt: start.fromAt, toAt: end.toAt, from, to };
}

export function netFromGrossCents(grossCents: number, vatRate: number) {
  if (!Number.isSafeInteger(grossCents) || !Number.isSafeInteger(vatRate) || vatRate < 0 || vatRate > 100) throw new Error("Άκυρη αξία ή ΦΠΑ");
  return grossCents - Math.round(grossCents * vatRate / (100 + vatRate));
}

export function signedDocument(document: { docType: string; netCents: number; vatCents: number; totalCents: number }) {
  const sign = document.docType === "5.1" ? -1 : 1;
  return { netCents: sign * document.netCents, vatCents: sign * document.vatCents, totalCents: sign * document.totalCents };
}

export function stockCostCents(quantityBase: number, unitCostHundredths: number, dimension: string) {
  if (!Number.isSafeInteger(quantityBase) || !Number.isSafeInteger(unitCostHundredths)) throw new Error("Άκυρο κόστος αποθέματος");
  return Math.round(quantityBase * unitCostHundredths / stockCostScale(dimension) / 100);
}

export type AllocationWeight = { id: string; weight: number };

/** Ακέραιος επιμερισμός με largest remainder· η ταυτότητα λύνει τις ισοπαλίες, όχι η σειρά της βάσης. */
export function allocateCents(totalCents: number, weights: readonly AllocationWeight[]) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Το επιμεριζόμενο ποσό πρέπει να είναι μη αρνητικά ακέραια λεπτά");
  const ids = new Set<string>();
  let weightTotal = 0;
  for (const row of weights) {
    if (ids.has(row.id) || !Number.isSafeInteger(row.weight) || row.weight < 0) throw new Error("Άκυρη βάση επιμερισμού");
    ids.add(row.id);
    weightTotal += row.weight;
    if (!Number.isSafeInteger(weightTotal)) throw new Error("Η βάση επιμερισμού υπερβαίνει το ασφαλές όριο");
  }
  if (!weights.length || !weightTotal) {
    if (totalCents) throw new Error("Δεν υπάρχει θετική βάση για τον επιμερισμό");
    return new Map(weights.map((row) => [row.id, 0]));
  }
  const shares = weights.map((row) => {
    const scaled = totalCents * row.weight;
    if (!Number.isSafeInteger(scaled)) throw new Error("Ο επιμερισμός υπερβαίνει το ασφαλές όριο");
    return { id: row.id, cents: Math.floor(scaled / weightTotal), remainder: scaled % weightTotal };
  });
  let remaining = totalCents - shares.reduce((sum, row) => sum + row.cents, 0);
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of order) {
    if (!remaining) break;
    row.cents += 1;
    remaining -= 1;
  }
  return new Map(shares.map((row) => [row.id, row.cents]));
}

export type CostComponents = { materialsCents: number; labourCents: number; wasteCents: number };
export type ProductionCostBatch = {
  id: string;
  outputLotId: string | null;
  costHundredths: number;
  labourCostCents: number;
  expectedQuantityGrams: number | null;
  quantityGrams: number;
  wasteGrams: number;
};
export type ProductionCostItem = { id: string; batchId: string; lotId: string | null; costHundredths: number };

/** Το ιστορικό κόστος πωληθείσας παρτίδας αναλύεται χωρίς δεύτερη χρέωση υλικών ή εργασίας. */
export function splitStockCostCents(totalCents: number, production?: CostComponents): CostComponents {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Άκυρο κόστος προς ανάλυση");
  if (!production || production.materialsCents + production.labourCents + production.wasteCents === 0) return { materialsCents: totalCents, labourCents: 0, wasteCents: 0 };
  const entries = [
    { id: "materials", weight: production.materialsCents },
    { id: "labour", weight: production.labourCents },
    { id: "waste", weight: production.wasteCents },
  ];
  const allocated = allocateCents(totalCents, entries);
  return { materialsCents: allocated.get("materials")!, labourCents: allocated.get("labour")!, wasteCents: allocated.get("waste")! };
}

/**
 * Αναδρομική ανάλυση ημιέτοιμων. Σε κάθε δόση, η τρέχουσα φύρα μεταφέρει αναλογικά
 * υλικά και δικό της/κληρονομημένο εργατικό κόστος στη φύρα· τα τρία μέρη αθροίζουν στο αρχικό COGS.
 */
export function productionCostProfiles(batches: readonly ProductionCostBatch[], items: readonly ProductionCostItem[]) {
  const byId = new Map(batches.map((batch) => [batch.id, batch]));
  if (byId.size !== batches.length) throw new Error("Διπλή παρτίδα στην ανάλυση κόστους");
  const byOutputLot = new Map<string, ProductionCostBatch>();
  for (const batch of batches) {
    if (!batch.outputLotId) continue;
    if (byOutputLot.has(batch.outputLotId)) throw new Error("Πολλαπλές παρτίδες για το ίδιο output lot");
    byOutputLot.set(batch.outputLotId, batch);
  }
  const itemsByBatch = new Map<string, ProductionCostItem[]>();
  for (const item of items) {
    if (!byId.has(item.batchId)) continue;
    itemsByBatch.set(item.batchId, [...(itemsByBatch.get(item.batchId) ?? []), item]);
  }
  const profiles = new Map<string, CostComponents>();
  const visiting = new Set<string>();

  function profile(batch: ProductionCostBatch): CostComponents {
    const known = profiles.get(batch.id);
    if (known) return known;
    if (visiting.has(batch.id)) throw new Error("Κυκλική αναφορά στην ανάλυση κόστους παραγωγής");
    visiting.add(batch.id);
    for (const value of [batch.costHundredths, batch.labourCostCents, batch.quantityGrams, batch.wasteGrams]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Άκυρα δεδομένα κόστους παραγωγής");
    }
    const expected = batch.expectedQuantityGrams ?? batch.quantityGrams + batch.wasteGrams;
    if (!Number.isSafeInteger(expected) || expected < 1 || batch.wasteGrams > expected) throw new Error("Άκυρη αναμενόμενη ποσότητα ή φύρα παραγωγής");

    const batchItems = itemsByBatch.get(batch.id) ?? [];
    const materialCents = Math.round(batch.costHundredths / 100);
    const itemWeights = batchItems.map((item) => ({ id: item.id, weight: item.costHundredths }));
    // Σε legacy δόση χωρίς γραμμές, το καταγεγραμμένο συνολικό κόστος μένει υλικό· δεν εφευρίσκεται εργασία ή φύρα.
    const itemCosts = batchItems.length && itemWeights.some((row) => row.weight > 0)
      ? allocateCents(materialCents, itemWeights)
      : new Map<string, number>();
    let materialsCents = batchItems.length && itemCosts.size ? 0 : materialCents;
    let labourCents = batch.labourCostCents;
    let wasteCents = 0;
    batchItems.forEach((item, index) => {
      if (!itemCosts.size) return;
      const itemCost = itemCosts.get(itemWeights[index]!.id)!;
      const source = item.lotId ? byOutputLot.get(item.lotId) : null;
      const parts = source ? splitStockCostCents(itemCost, profile(source)) : { materialsCents: itemCost, labourCents: 0, wasteCents: 0 };
      materialsCents += parts.materialsCents;
      labourCents += parts.labourCents;
      wasteCents += parts.wasteCents;
    });
    const materialWaste = Math.round(materialsCents * batch.wasteGrams / expected);
    const labourWaste = Math.round(labourCents * batch.wasteGrams / expected);
    const result = { materialsCents: materialsCents - materialWaste, labourCents: labourCents - labourWaste, wasteCents: wasteCents + materialWaste + labourWaste };
    visiting.delete(batch.id);
    profiles.set(batch.id, result);
    return result;
  }

  batches.forEach(profile);
  return profiles;
}

export function agingBucket(dueAt: Date | null, at: Date) {
  const days = Math.floor((at.getTime() - (dueAt ?? at).getTime()) / 86_400_000);
  return days <= 0 ? "current" as const : days <= 30 ? "days1to30" as const : days <= 60 ? "days31to60" as const : days <= 90 ? "days61to90" as const : "over90" as const;
}

export type CustomerOutstandingDocument = {
  id: string;
  customerId: string;
  docType: string;
  status: string;
  totalCents: number;
  dueAt: Date | null;
  fiscalDocumentId: string | null;
  allocations: readonly { amountCents: number }[];
};

function assertNonNegativeCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Άκυρο ποσό παραστατικού");
}

export function customerOutstandingDocuments<T extends CustomerOutstandingDocument>(documents: readonly T[], fiscalDocuments: readonly { id: string; relatedId: string | null }[]) {
  const relatedByFiscalId = new Map(fiscalDocuments.map((row) => [row.id, row.relatedId]));
  const invoices = documents.filter((document) => document.docType === "1.1");
  const invoiceByFiscalId = new Map(invoices.filter((document) => document.fiscalDocumentId).map((document) => [document.fiscalDocumentId!, document]));
  const relatedCredits = new Map<string, number>();
  for (const credit of documents) {
    if (credit.docType !== "5.1" || credit.status !== "ISSUED") continue;
    assertNonNegativeCents(credit.totalCents);
    const relatedId = credit.fiscalDocumentId ? relatedByFiscalId.get(credit.fiscalDocumentId) : null;
    const invoice = relatedId ? invoiceByFiscalId.get(relatedId) : null;
    if (!invoice || invoice.customerId !== credit.customerId) continue;
    // Μόνο η ρητή σχέση relatedId δένει την πίστωση· δεν κατανέμεται υπόλοιπο πιστωτικού σε άλλα τιμολόγια.
    relatedCredits.set(invoice.id, (relatedCredits.get(invoice.id) ?? 0) + credit.totalCents);
  }
  return invoices.flatMap((document) => {
    const allocatedCents = document.allocations.reduce((sum, row) => {
      assertNonNegativeCents(row.amountCents);
      return sum + row.amountCents;
    }, 0);
    const creditCents = relatedCredits.get(document.id) ?? 0;
    if (document.status !== "ISSUED" && !(document.status === "CANCELLED" && (allocatedCents || creditCents))) return [];
    assertNonNegativeCents(document.totalCents);
    const outstandingCents = Math.max(0, document.totalCents - allocatedCents - creditCents);
    return outstandingCents ? [{ ...document, outstandingCents }] : [];
  });
}

export type AgingTotals = { current: number; days1to30: number; days31to60: number; days61to90: number; over90: number };
export const emptyAging = (): AgingTotals => ({ current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });

export function addAging(totals: AgingTotals, amountCents: number, dueAt: Date | null, at: Date) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Άκυρο απλήρωτο ποσό");
  totals[agingBucket(dueAt, at)] += amountCents;
  return totals;
}
