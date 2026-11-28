// Κλειδιά myDATA ανά ΑΦΜ: της επιχείρησης, των νομικών προσώπων (LegalEntity) και όσων καταστημάτων έχουν δικό τους χρήστη.
// Ένας ΑΦΜ μπορεί να έχει χρήστη ανά κατάστημα· όλοι βλέπουν τα παραστατικά του ΑΦΜ, οπότε ο καλών ενώνει ανά MARK.
// Χρησιμοποιείται από τον έλεγχο αποδείξεων, τα τιμολόγια που λείπουν και τον έλεγχο σκαναρισμένων.
import { db } from "./db";

/** Ένα ζεύγος κλειδιών και σε ποιον ανήκει, π.χ. «Κατάστημα Πειραιά» ή «Η επιχείρηση». */
export type MydataKeys = { userId: string; subKey: string; source: string };
export type MydataIssuer = { vat: string; name: string; keys: MydataKeys[] };

/** Επιχειρήσεις με τουλάχιστον ένα ζεύγος κλειδιών (για τους βραδινούς γύρους). */
export const HAS_KEYS = { OR: [{ aadeUserId: { not: null } }, { legalEntities: { some: { active: true, aadeUserId: { not: null } } } }, { stores: { some: { active: true, aadeUserId: { not: null } } } }] };

/** Οι εκδότες της επιχείρησης με όλα τα κλειδιά του ΑΦΜ τους. Ίδιος χρήστης σε πολλά καταστήματα = ένα ζεύγος. */
export async function issuers(orgId: string): Promise<MydataIssuer[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: {
    vatNumber: true, name: true, legalName: true, aadeUserId: true, aadeSubKey: true,
    legalEntities: { where: { active: true }, select: { id: true, vatNumber: true, name: true, aadeUserId: true, aadeSubKey: true } },
    stores: { where: { active: true, aadeUserId: { not: null }, aadeSubKey: { not: null } }, orderBy: { name: "asc" }, select: { name: true, legalEntityId: true, aadeUserId: true, aadeSubKey: true } },
  } });
  const keysOf = (userId: string | null, subKey: string | null, source: string): MydataKeys[] => (userId && subKey ? [{ userId, subKey, source }] : []);
  const storeKeys = (entityId: string | null) => org.stores.filter((s) => s.legalEntityId === entityId).flatMap((s) => keysOf(s.aadeUserId, s.aadeSubKey, s.name));
  const list: MydataIssuer[] = org.vatNumber ? [{ vat: org.vatNumber, name: org.legalName || org.name, keys: [...keysOf(org.aadeUserId, org.aadeSubKey, "Η επιχείρηση"), ...storeKeys(null)] }] : [];
  for (const e of org.legalEntities) {
    const keys = [...keysOf(e.aadeUserId, e.aadeSubKey, e.name), ...storeKeys(e.id)];
    const same = list.find((i) => i.vat === e.vatNumber);
    if (same) same.keys.push(...keys); else list.push({ vat: e.vatNumber, name: e.name, keys });
  }
  for (const i of list) i.keys = dedupeKeys(i.keys);
  return list;
}

/** Ίδιο ζεύγος σε πολλές πηγές → ένα, με τις πηγές ενωμένες («Κατάστημα Πειραιά, Κατάστημα Γλυφάδας»). */
export function dedupeKeys(keys: MydataKeys[]): MydataKeys[] {
  const out: MydataKeys[] = [];
  for (const k of keys) {
    const same = out.find((x) => x.userId === k.userId && x.subKey === k.subKey);
    if (same) same.source = `${same.source}, ${k.source}`; else out.push({ ...k });
  }
  return out;
}

/** Έχει η επιχείρηση κλειδιά myDATA οπουδήποτε (επιχείρηση, εκδότης ή κατάστημα); */
export async function hasMydataKeys(orgId: string) {
  return !!(await db.organization.count({ where: { id: orgId, ...HAS_KEYS } }));
}
