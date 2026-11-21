// Αρίθμηση σειρών παραστατικών εκτός ταμείου (τιμολόγια, πιστωτικά, δελτία αποστολής),
// στο πρότυπο του Device.nextAa του POS (lib/pos.ts): κλείδωμα γραμμής μέσα στη συναλλαγή,
// ο ΑΑ «καίγεται» μόνο όταν ολοκληρωθεί η έκδοση.
// Οι αποδείξεις POS δεν περνούν από εδώ — η σειρά τους είναι της συσκευής.
import type { Prisma } from "../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;

/**
 * Κλειδώνει τη σειρά (orgId + τύπος + χαρακτήρας) και επιστρέφει τον τρέχοντα ΑΑ.
 * Αν η σειρά δεν υπάρχει, δημιουργείται — δύο ταυτόχρονες δημιουργίες της ίδιας σειράς
 * σκάνε στη μοναδικότητα (orgId, docType, code)· η χαμένη συναλλαγή ξαναδοκιμάζει.
 */
export async function lockSeries(tx: Tx, orgId: string, docType: string, code: string, storeId?: string | null) {
  const rows = await tx.$queryRaw<{ id: string; nextAa: number }[]>`
    SELECT id, "nextAa" FROM "DocumentSeries"
    WHERE "orgId" = ${orgId} AND "docType" = ${docType} AND code = ${code} FOR UPDATE`;
  if (rows.length > 0) return rows[0];
  return tx.documentSeries.create({ data: { orgId, docType, code, storeId: storeId ?? null }, select: { id: true, nextAa: true } });
}

/** Μετά την επιτυχή έκδοση: ο ΑΑ της σειράς προχωρά. */
export async function advanceSeries(tx: Tx, seriesId: string) {
  await tx.documentSeries.update({ where: { id: seriesId }, data: { nextAa: { increment: 1 } } });
}
