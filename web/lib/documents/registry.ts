// Οι τύποι παραστατικών από τον κοινό πίνακα της πλατφόρμας (DocumentType): η βάση είναι η πηγή
// αλήθειας για το ποιοι τύποι είναι διαθέσιμοι προς έκδοση. Τα στατικά DOC_TYPES (types.ts)
// μένουν ως αναφορά και περιεχόμενο του seed.
import { cache } from "react";
import { db } from "../db.ts";
import type { DocTypeInfo } from "./types.ts";

const toInfo = (t: { code: string; title: string; sign: number; retail: boolean; needsParty: boolean; needsRelated: boolean; receiptCase: string | null }): DocTypeInfo => ({
  code: t.code,
  title: t.title,
  sign: t.sign === -1 ? -1 : 1,
  retail: t.retail,
  needsParty: t.needsParty,
  needsRelated: t.needsRelated,
  receiptCase: t.receiptCase === null ? null : BigInt(t.receiptCase),
});

/** Όλοι οι τύποι (ή μόνο οι ενεργοί), με memoization ανά request. */
export const listDocTypes = cache(async (onlyActive = false) =>
  (await db.documentType.findMany({ where: onlyActive ? { active: true } : {}, orderBy: [{ sort: "asc" }, { code: "asc" }] })).map(toInfo),
);

/** Ενεργός τύπος για έκδοση· άγνωστος ή απενεργοποιημένος = σφάλμα, ποτέ σιωπηρή αποδοχή. */
export async function getDocType(code: string): Promise<DocTypeInfo> {
  const t = await db.documentType.findUnique({ where: { code } });
  if (!t || !t.active) throw new RangeError(`Ο τύπος παραστατικού ${code} δεν είναι διαθέσιμος`);
  return toInfo(t);
}
