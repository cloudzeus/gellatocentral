// Ρυθμίσεις εκδοτών και σειρών: κανόνες χωρίς βάση (ελέγχονται με node --test).

/** Τύποι που χρειάζεται ένα κατάστημα με χονδρική: τιμολόγιο, δελτίο αποστολής, πιστωτικό. */
export const WHOLESALE_TYPES = ["1.1", "9.3", "5.1"] as const;

/** Ποιοι από τους απαιτούμενους τύπους δεν έχουν ενεργή σειρά στο κατάστημα (ή σειρά χωρίς κατάστημα). */
export function missingTypes(needed: readonly string[], series: readonly { docType: string; storeId: string | null; active: boolean }[], storeId: string): string[] {
  const covered = new Set(series.filter((s) => s.active && (s.storeId === storeId || s.storeId === null)).map((s) => s.docType));
  return needed.filter((t) => !covered.has(t));
}

type IssuerFields = { name?: string | null; vatNumber?: string | null; taxOffice?: string | null; address?: string | null; city?: string | null; postalCode?: string | null; vivaMerchantId?: string | null; aadeUserId?: string | null; aadeSubKey?: string | null };

/** Τι λείπει για να εκδίδει ένας εκδότης: στοιχεία στο παραστατικό, κλειδιά myDATA, έμπορος Viva. */
export function issuerReadiness(i: IssuerFields) {
  const blank = (v?: string | null) => !v?.trim();
  const missingFields = ([["name", "επωνυμία"], ["vatNumber", "ΑΦΜ"], ["taxOffice", "ΔΟΥ"], ["address", "διεύθυνση"], ["city", "πόλη"], ["postalCode", "ΤΚ"]] as const)
    .filter(([k]) => blank(i[k])).map(([, label]) => label);
  return { missingFields, mydata: !blank(i.aadeUserId) && !blank(i.aadeSubKey), viva: !blank(i.vivaMerchantId) };
}
