// Συναλλασσόμενοι: ρόλοι, είδη διευθύνσεων και έλεγχοι που δεν θέλουν βάση.
// Ένας συναλλασσόμενος μπορεί να έχει πολλούς ρόλους μαζί (π.χ. πελάτης ΚΑΙ προμηθευτής).
export const PARTY_ROLES = {
  customer: { label: "Πελάτης", plural: "Πελάτες", hint: "Του πουλάμε" },
  supplier: { label: "Προμηθευτής", plural: "Προμηθευτές", hint: "Αγοράζουμε από αυτόν" },
  franchisee: { label: "Franchisee", plural: "Franchisees", hint: "Λειτουργεί κατάστημα με το σήμα μας" },
  partner: { label: "Συνεργάτης", plural: "Συνεργάτες", hint: "Λογιστής, μεταφορέας, αντιπρόσωπος, τεχνικός" },
} as const;
export type PartyRole = keyof typeof PARTY_ROLES;
export const isPartyRole = (v: unknown): v is PartyRole => typeof v === "string" && v in PARTY_ROLES;
/** Οι έγκυροι ρόλοι μιας φόρμας, χωρίς διπλούς και με σταθερή σειρά. Κάθε συναλλασσόμενος έχει τουλάχιστον έναν. */
export const cleanRoles = (values: readonly unknown[]): PartyRole[] => (Object.keys(PARTY_ROLES) as PartyRole[]).filter((r) => values.includes(r));
export const roleText = (roles: readonly string[]) => roles.filter(isPartyRole).map((r) => PARTY_ROLES[r].label).join(", ") || "Χωρίς ρόλο";

export const ADDRESS_KINDS = { branch: "Υποκατάστημα", delivery: "Διεύθυνση παράδοσης", billing: "Διεύθυνση τιμολόγησης", other: "Άλλη" } as const;
export type AddressKind = keyof typeof ADDRESS_KINDS;
export const isAddressKind = (v: unknown): v is AddressKind => typeof v === "string" && v in ADDRESS_KINDS;

/** IBAN χωρίς κενά και με κεφαλαία, ή null αν δεν περνά τον έλεγχο (μήκος ανά χώρα όπου το ξέρουμε, και mod 97). */
const IBAN_LENGTH: Record<string, number> = { GR: 27, CY: 28, DE: 22, IT: 27, FR: 27, ES: 24, NL: 18, BE: 16, AT: 20, PT: 25, BG: 22, RO: 24, IE: 22, GB: 22, CH: 21 };
export function cleanIban(input: string): string | null {
  const iban = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const expected = IBAN_LENGTH[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return null;
  // μεταφορά των 4 πρώτων στο τέλος, γράμματα → αριθμοί (A=10 … Z=35), υπόλοιπο διαίρεσης με το 97 πρέπει να είναι 1
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? iban : null;
}
/** «GR16 0110 1250 0000 0001 2300 695» για εμφάνιση. */
export const showIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

/** Συντεταγμένες από φόρμα («37,9838» ή «37.9838»). null αν λείπει κάποια ή είναι εκτός ορίων· ποτέ μισό ζευγάρι. */
export function cleanCoords(lat: unknown, lng: unknown): { latitude: number; longitude: number } | null {
  const n = (v: unknown) => (typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : typeof v === "number" ? v : NaN);
  const latitude = n(lat), longitude = n(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
/** Απόσταση δύο σημείων σε χιλιόμετρα, σε ευθεία γραμμή (haversine). Για «ποιο κατάστημα είναι πιο κοντά», όχι για διαδρομές. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
