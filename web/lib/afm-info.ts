// Στοιχεία ελληνικής επιχείρησης από το ΑΦΜ, μέσω της δικής μας υπηρεσίας afm2info (vat.wwa.gr), η οποία ρωτά το
// μητρώο της ΑΑΔΕ. Δεν θέλει κωδικούς. Ίδια υπηρεσία και ίδια αντιστοίχιση πεδίων με τα υπόλοιπα έργα μας.
//   POST https://vat.wwa.gr/afm2info  { afm: "094019245" } → { basic_rec: {…}, firm_act_tab: { item: [] | {} } }
import { validAfm } from "./afm.ts";

const ENDPOINT = "https://vat.wwa.gr/afm2info";
export type AfmInfo = { afm: string; name: string; tradeName: string | null; taxOffice: string | null; taxOfficeCode: string | null; legalForm: string | null; address: string | null; postalCode: string | null; city: string | null; profession: string | null; status: string | null; active: boolean };
/** Λάθος της αναζήτησης με μήνυμα για τον χρήστη. «Δεν βρέθηκε» ΔΕΝ είναι λάθος: η αναζήτηση επιστρέφει null. */
export class AfmLookupError extends Error {}

// κενό ή μόνο κενά διαστήματα = δεν υπάρχει τιμή
const s = (v: unknown): string | null => (typeof v === "string" ? v.trim() || null : typeof v === "number" ? String(v) : null);
type Raw = { basic_rec?: Record<string, unknown>; firm_act_tab?: { item?: unknown } };

/** Η απάντηση της υπηρεσίας στα πεδία της καρτέλας συναλλασσόμενου. null = το ΑΦΜ δεν υπάρχει στο μητρώο. */
export function mapAfmInfo(raw: Raw | null | undefined): AfmInfo | null {
  const b = raw?.basic_rec;
  if (!b || !s(b.afm)) return null;
  // οι δραστηριότητες έρχονται ως πίνακας, ως ένα αντικείμενο ή καθόλου· firm_act_kind «1» = κύρια
  const item = raw?.firm_act_tab?.item;
  const acts = (item == null ? [] : Array.isArray(item) ? item : [item]) as Record<string, unknown>[];
  const main = acts.find((a) => s(a?.firm_act_kind) === "1") ?? acts[0];
  return {
    afm: s(b.afm)!,
    name: s(b.onomasia) ?? "",
    tradeName: s(b.commer_title),
    taxOffice: s(b.doy_descr),
    taxOfficeCode: s(b.doy),
    legalForm: s(b.legal_status_descr),
    address: [s(b.postal_address), s(b.postal_address_no)].filter(Boolean).join(" ") || null,
    postalCode: s(b.postal_zip_code),
    city: s(b.postal_area_description),
    profession: s(main?.firm_act_descr),
    status: s(b.deactivation_flag_descr),
    // deactivation_flag «1» χωρίς ημερομηνία διακοπής = ενεργή επιχείρηση
    active: s(b.deactivation_flag) === "1" && !s(b.stop_date),
  };
}

export async function afmInfo(afm: string): Promise<AfmInfo | null> {
  const clean = String(afm ?? "").replace(/\s+/g, "");
  if (!validAfm(clean)) throw new AfmLookupError("Το ΑΦΜ δεν είναι έγκυρο (9 ψηφία με σωστό ψηφίο ελέγχου)");
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ afm: clean }), cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) throw new AfmLookupError("Η υπηρεσία της ΑΑΔΕ δεν απάντησε. Δοκίμασε ξανά σε λίγο ή συμπλήρωσε τα στοιχεία με το χέρι");
  if (!res.ok) throw new AfmLookupError(`Η υπηρεσία της ΑΑΔΕ επέστρεψε σφάλμα (${res.status}). Συμπλήρωσε τα στοιχεία με το χέρι`);
  return mapAfmInfo((await res.json().catch(() => null)) as Raw | null);
}
