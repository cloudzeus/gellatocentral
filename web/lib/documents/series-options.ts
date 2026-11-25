// Οι σειρές που προτείνονται στη φόρμα έκδοσης: ενεργές, του τύπου, του καταστήματος ή χωρίς κατάστημα· πρώτη η προεπιλογή.
import { db } from "../db";

export async function seriesOptions(orgId: string | null, docType: string, storeId?: string | null): Promise<[string, string][]> {
  const rows = await db.documentSeries.findMany({
    where: { orgId, docType, active: true, ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : {}) },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, nextAa: true },
  });
  return rows.map((s) => [s.id, `${s.code}${s.name ? ` · ${s.name}` : ""} (επόμενος ${s.nextAa})`]);
}
