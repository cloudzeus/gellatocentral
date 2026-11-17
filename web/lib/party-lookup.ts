// Συμπλήρωση στοιχείων συναλλασσόμενου από το ΑΦΜ του. Μία είσοδος για όλες τις χώρες:
//   Ελλάδα → afm2info (μητρώο ΑΑΔΕ) · υπόλοιπη ΕΕ, Νορβηγία, Ελβετία → επίσημα μητρώα μέσω lib/vat-check (VIES κ.λπ.)
// Γίνεται ΜΟΝΟ όταν το ζητά ο χρήστης, ποτέ μαζικά. Οι ξένοι έλεγχοι γράφονται στο ιστορικό (αριθμός ελέγχου VIES).
import { afmInfo, AfmLookupError } from "./afm-info";
import { setting } from "./config";
import { db } from "./db";
import { checkVat, parseVatTarget } from "./vat-check";

export const VAT_CACHE_DAYS = 30;
export type PartyLookup = {
  ok: boolean;
  message: string | null; // τι να δει ο χρήστης όταν δεν βρέθηκε ή δεν έγινε ο έλεγχος
  source: string | null; // «ΑΑΔΕ», «VIES»…
  fields: { name?: string; tradeName?: string; taxOffice?: string; profession?: string; address?: string; city?: string; postalCode?: string };
  active: boolean | null; // null = η πηγή δεν το λέει
  consultationNumber: string | null;
  checkedAt: string | null;
  cached: boolean;
};
const none = (message: string): PartyLookup => ({ ok: false, message, source: null, fields: {}, active: null, consultationNumber: null, checkedAt: null, cached: false });
const filled = (o: Record<string, string | null | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && v !== "---")) as PartyLookup["fields"]; // το «---» του VIES σημαίνει «το κράτος το κρύβει», όχι τιμή

export async function lookupParty(input: { countryCode: string; vat: string; org: { id: string; vatNumber: string } | null; userName: string; force?: boolean }): Promise<PartyLookup> {
  const country = input.countryCode.toUpperCase();
  const vat = input.vat.replace(/[\s.-]+/g, "").toUpperCase().replace(/^(EL|GR)(?=\d{9}$)/, "");
  if (country === "GR") {
    try {
      const r = await afmInfo(vat);
      if (!r) return none("Το ΑΦΜ δεν βρέθηκε στο μητρώο της ΑΑΔΕ. Έλεγξέ το ή συμπλήρωσε τα στοιχεία με το χέρι");
      return { ok: true, message: r.active ? null : `Προσοχή: στην ΑΑΔΕ εμφανίζεται ως «${r.status ?? "μη ενεργή"}»`, source: "ΑΑΔΕ", fields: filled({ name: r.name, tradeName: r.tradeName, taxOffice: r.taxOffice, profession: r.profession, address: r.address, city: r.city, postalCode: r.postalCode }), active: r.active, consultationNumber: null, checkedAt: new Date().toISOString(), cached: false };
    } catch (e) {
      return none(e instanceof AfmLookupError ? e.message : "Η αναζήτηση στην ΑΑΔΕ απέτυχε. Συμπλήρωσε τα στοιχεία με το χέρι");
    }
  }
  // ξένο ΑΦΜ: με το πρόθεμα της χώρας, όπως το θέλουν τα μητρώα
  const raw = /^[A-Z]{2}/.test(vat) ? vat : `${country}${vat}`;
  const target = parseVatTarget(raw);
  if (!target) return none("Το ΑΦΜ δεν έχει τη μορφή που περιμένει η χώρα. Γράψ' το όπως στο τιμολόγιο του συναλλασσόμενου");
  const orgId = input.org?.id ?? null;
  if (!input.force) {
    const row = await db.vatCheck.findFirst({ where: { orgId, vat: target.vat, valid: { not: null }, createdAt: { gte: new Date(Date.now() - VAT_CACHE_DAYS * 864e5) } }, orderBy: { createdAt: "desc" } });
    if (row) return { ok: !!row.valid, message: row.valid ? null : "Το ΑΦΜ δεν είναι ενεργό στο μητρώο ΦΠΑ της χώρας", source: row.source, fields: filled({ name: row.name, address: row.address }), active: row.valid, consultationNumber: row.consultationNumber, checkedAt: row.createdAt.toISOString(), cached: true };
  }
  // ο ΔΙΚΟΣ ΜΑΣ ΑΦΜ → το VIES δίνει αριθμό ελέγχου (αποδεικτικό): της επιχείρησης που ρωτά, αλλιώς της πλατφόρμας
  const own = input.org?.vatNumber ?? (await setting("PLATFORM_VAT"));
  const requesterVat = /^\d{9}$/.test(own) ? `EL${own}` : null;
  const r = await checkVat(raw, { requesterVat });
  await db.vatCheck.create({ data: { orgId, vat: r.vat, countryCode: r.countryCode, valid: r.valid, name: r.name, address: r.address, provider: r.provider, source: r.source, consultationNumber: r.consultationNumber, requester: r.consultationNumber ? requesterVat : null, match: r.match ?? undefined, error: r.error ?? null, message: r.message ?? null, createdByName: input.userName } }).catch(() => null);
  if (r.valid === null) return none(r.message ?? "Ο έλεγχος δεν έγινε. Δοκίμασε ξανά σε λίγο");
  return { ok: r.valid, message: r.valid ? (r.message ?? null) : (r.message ?? "Το ΑΦΜ δεν είναι ενεργό στο μητρώο ΦΠΑ της χώρας"), source: r.source, fields: filled({ name: r.name, address: r.address }), active: r.valid, consultationNumber: r.consultationNumber, checkedAt: r.checkedAt, cached: false };
}
