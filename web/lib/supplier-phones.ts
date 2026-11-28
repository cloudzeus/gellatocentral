// Τηλέφωνα προμηθευτή για άμεση κλήση από την αποθήκη (καθαρή λογική, χωρίς βάση).
export type SupplierPhone = { who: string; label: string | null; phone: string };
type PhoneSource = { name: string; phone: string | null; contactName: string | null; channels: { value: string; label: string | null }[]; contacts: { title: string | null; person: { name: string; channels: { value: string; label: string | null }[] } }[] };

/** Όλα τα τηλέφωνα του προμηθευτή για άμεση κλήση από την αποθήκη: εταιρία πρώτα, μετά οι επαφές. Χωρίς διπλά. */
export function supplierPhones(s: PhoneSource): SupplierPhone[] {
  const out: SupplierPhone[] = [];
  const add = (who: string, label: string | null, phone: string | null) => { const p = phone?.trim(); if (p && !out.some((x) => x.phone === p)) out.push({ who, label, phone: p }); };
  // το όνομα της εταιρίας φαίνεται ήδη στην κεφαλίδα· εδώ μόνο «ποιον παίρνω»
  add(s.contactName ?? "Κεντρικό", s.contactName ? "Υπεύθυνος" : null, s.phone);
  for (const c of s.channels) add(c.label ?? "Εταιρία", null, c.value);
  for (const c of s.contacts) for (const ch of c.person.channels) add(c.person.name, [c.title, ch.label].filter(Boolean).join(" · ") || null, ch.value);
  return out;
}
