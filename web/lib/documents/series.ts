// Αρίθμηση σειρών παραστατικών εκτός ταμείου (τιμολόγια, πιστωτικά, δελτία αποστολής),
// στο πρότυπο του Device.nextAa του POS (lib/pos.ts): κλείδωμα γραμμής μέσα στη συναλλαγή,
// ο ΑΑ «καίγεται» μόνο όταν ολοκληρωθεί η έκδοση.
// Οι σειρές ορίζονται στις Ρυθμίσεις › Σειρές (ή στην Τιμολόγηση της πλατφόρμας, orgId κενό)·
// η έκδοση δέχεται μόνο υπάρχουσα ενεργή σειρά του σωστού τύπου, ώστε ένα τυπογραφικό λάθος να μην ανοίγει νέα σειρά.
// Οι αποδείξεις POS δεν περνούν από εδώ — η σειρά τους είναι της συσκευής.
import type { Prisma } from "../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;
export type LockedSeries = { id: string; code: string; nextAa: number; transmit: boolean; storeId: string | null };

export class SeriesError extends Error {}

/** Κλειδώνει τη σειρά της επιχείρησης (ή της πλατφόρμας, orgId null) και επιστρέφει τον τρέχοντα ΑΑ. */
export async function lockSeries(tx: Tx, orgId: string | null, seriesId: string, docType: string): Promise<LockedSeries> {
  const rows = await tx.$queryRaw<LockedSeries[]>`
    SELECT id, code, "nextAa", transmit, "storeId" FROM "DocumentSeries"
    WHERE id = ${seriesId} AND "orgId" IS NOT DISTINCT FROM ${orgId} AND "docType" = ${docType} AND active FOR UPDATE`;
  if (!rows[0]) throw new SeriesError(`Διάλεξε ενεργή σειρά για παραστατικό ${docType}`);
  return rows[0];
}

/**
 * Σειρά που προκύπτει μηχανικά (πιστωτικά λιανικής «Π» + σειρά συσκευής): δημιουργείται αν λείπει.
 * Δύο ταυτόχρονες δημιουργίες σκάνε στη μοναδικότητα (orgId, docType, code)· η χαμένη συναλλαγή ξαναδοκιμάζει.
 */
export async function ensureSeries(tx: Tx, orgId: string, docType: string, code: string, storeId?: string | null): Promise<LockedSeries> {
  const existing = await tx.documentSeries.findUnique({ where: { orgId_docType_code: { orgId, docType, code } }, select: { id: true } });
  const id = existing?.id ?? (await tx.documentSeries.create({ data: { orgId, docType, code, storeId: storeId ?? null, name: "Αυτόματη από τη συσκευή" }, select: { id: true } })).id;
  return lockSeries(tx, orgId, id, docType);
}

/** Μετά την επιτυχή έκδοση: ο ΑΑ της σειράς προχωρά. */
export async function advanceSeries(tx: Tx, seriesId: string) {
  await tx.documentSeries.update({ where: { id: seriesId }, data: { nextAa: { increment: 1 } } });
}
