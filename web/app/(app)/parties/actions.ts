"use server";
// Συναλλασσόμενοι: της επιχείρησης του χρήστη ή, για το προσωπικό, της πλατφόρμας. Το πεδίο το δίνει το partyScope():
// κάθε ερώτημα φιλτράρει με το orgId του, ώστε κανείς να μην αγγίζει συναλλασσόμενο άλλου, ακόμα κι αν μαντέψει το id.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validAfm } from "@/lib/afm";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { GdprError, recordConsent, requestErasure } from "@/lib/gdpr";
import { geocode } from "@/lib/geocode";
import { cleanCoords, cleanIban, cleanRoles, isAddressKind } from "@/lib/parties";
import { partyScope, type PartyScope } from "@/lib/party-scope";

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const email = text(160).refine((v) => !v || z.string().email().safeParse(v).success, "Το email δεν είναι έγκυρο");
const schema = z.object({
  name: z.string().trim().min(2, "Γράψε την επωνυμία ή το ονοματεπώνυμο").max(160),
  tradeName: text(160),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Διάλεξε χώρα"),
  vatNumber: z.string().trim().max(24).transform((v) => v.toUpperCase().replace(/[\s.-]+/g, "") || null),
  taxOffice: text(80),
  profession: text(160),
  contactName: text(120),
  email,
  phone: text(40),
  website: text(160),
  address: text(200),
  city: text(80),
  postalCode: text(10),
  region: text(80),
  paymentTermsDays: z.string().trim().transform((v) => (v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), "Οι ημέρες πίστωσης είναι από 0 έως 365"),
  paymentMethod: text(20),
  notes: text(1000),
});
// το μήνυμα μπαίνει ΠΡΙΝ από το #τμήμα: αλλιώς ο browser το θεωρεί μέρος του και η σελίδα δεν το βλέπει
const fail = (to: string, error: string): never => {
  const [path, hash] = to.split("#");
  return redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}${hash ? `#${hash}` : ""}`);
};
const editor = async (): Promise<PartyScope> => {
  const s = await partyScope();
  if (!s.canEdit) redirect(`${s.base}?error=${encodeURIComponent("Ο ρόλος σου επιτρέπει μόνο προβολή")}`);
  return s;
};
/** Ο συναλλασσόμενος, μόνο αν ανήκει στο αρχείο του χρήστη. */
const owned = async (s: PartyScope, id: string) => (await db.party.findFirst({ where: { id, orgId: s.orgId } })) ?? redirect(s.base);
/** Συντεταγμένες από τη φόρμα: και οι δύο ή καμία. Με κενά πεδία σβήνονται. */
function coords(form: FormData, back: string) {
  const lat = String(form.get("latitude") ?? "").trim(), lng = String(form.get("longitude") ?? "").trim();
  if (!lat && !lng) return { latitude: null, longitude: null };
  return cleanCoords(lat, lng) ?? fail(back, "Οι συντεταγμένες θέλουν και πλάτος και μήκος, π.χ. 37,9838 και 23,7275");
}

/** Νέος συναλλασσόμενος (id = null) ή αλλαγή στοιχείων. Έχει τουλάχιστον έναν ρόλο και μπορεί να έχει πολλούς. */
export async function saveParty(id: string | null, form: FormData) {
  const s = await editor();
  const back = id ? `${s.base}/${id}` : s.base;
  const d = schema.safeParse(Object.fromEntries(form));
  if (!d.success) return fail(back, d.error.issues[0].message);
  const roles = cleanRoles(form.getAll("roles"));
  if (!roles.length) return fail(back, "Διάλεξε τουλάχιστον έναν ρόλο: πελάτης, προμηθευτής, franchisee ή συνεργάτης");
  const vat = d.data.countryCode === "GR" ? d.data.vatNumber?.replace(/^(EL|GR)/, "") ?? null : d.data.vatNumber;
  if (vat && d.data.countryCode === "GR" && !validAfm(vat)) return fail(back, "Το ΑΦΜ δεν είναι έγκυρο (9 ψηφία με σωστό ψηφίο ελέγχου)");
  if (vat && (await db.party.findFirst({ where: { orgId: s.orgId, vatNumber: vat, ...(id ? { id: { not: id } } : {}) } }))) return fail(back, `Υπάρχει ήδη συναλλασσόμενος με ΑΦΜ ${vat}. Άνοιξε την καρτέλα του και πρόσθεσέ του τον ρόλο`);
  // «επιβεβαιώθηκε από το μητρώο» ισχύει μόνο αν η φόρμα το δηλώνει ΚΑΙ το ΑΦΜ δεν άλλαξε μετά την αναζήτηση
  const checked = form.get("vatCheckedFor") === `${d.data.countryCode}${vat ?? ""}` && vat ? { vatCheckedAt: new Date() } : {};
  const data = { ...d.data, vatNumber: vat, roles, ...coords(form, back), ...checked };
  if (id) {
    const before = await owned(s, id);
    await db.party.update({ where: { id: before.id }, data: before.vatNumber !== vat && !("vatCheckedAt" in checked) ? { ...data, vatCheckedAt: null } : data });
    revalidatePath(back);
    redirect(`${back}?saved=1`);
  }
  const created = await db.party.create({ data: { ...data, orgId: s.orgId } });
  redirect(`${s.base}/${created.id}?saved=1`);
}

export async function toggleParty(id: string) {
  const s = await editor();
  const p = await owned(s, id);
  await db.party.update({ where: { id: p.id }, data: { active: !p.active } });
  revalidatePath(s.base);
}

/** Συντεταγμένες της έδρας από τη διεύθυνσή της (OpenStreetMap). Αν δεν βρεθούν, ο χρήστης τις βάζει από τον χάρτη. */
export async function locateParty(id: string) {
  const s = await editor();
  const p = await owned(s, id);
  const hit = await geocode({ street: p.address, city: p.city, postalCode: p.postalCode, countryCode: p.countryCode });
  if (!hit) return fail(`${s.base}/${id}`, "Η διεύθυνση δεν βρέθηκε στον χάρτη. Έλεγξε οδό και πόλη, ή βάλε την πινέζα με το χέρι από το «Αλλαγή»");
  await db.party.update({ where: { id: p.id }, data: { latitude: hit.latitude, longitude: hit.longitude } });
  revalidatePath(`${s.base}/${id}`);
  redirect(`${s.base}/${id}?saved=located#map`);
}

// ---- Υποκαταστήματα και διευθύνσεις ----
const addressSchema = z.object({
  label: text(80),
  street: z.string().trim().min(2, "Γράψε τη διεύθυνση").max(200),
  city: text(80),
  postalCode: text(10),
  region: text(80),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("GR"),
  phone: text(40),
  email,
  notes: text(300),
  branchNo: z.string().trim().transform((v) => (v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 9999), "Ο αριθμός εγκατάστασης είναι από 1 και πάνω (το 0 είναι η έδρα)"),
});
export async function saveAddress(partyId: string, addressId: string | null, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const back = `${s.base}/${p.id}`;
  const d = addressSchema.safeParse(Object.fromEntries(form));
  if (!d.success) return fail(`${back}#addresses`, d.error.issues[0].message);
  const kind = form.get("kind");
  if (!isAddressKind(kind)) return fail(`${back}#addresses`, "Διάλεξε είδος διεύθυνσης");
  // αριθμό εγκατάστασης έχουν μόνο τα υποκαταστήματα, και είναι μοναδικός ανά συναλλασσόμενο
  const branchNo = kind === "branch" ? d.data.branchNo : null;
  if (branchNo && (await db.partyAddress.findFirst({ where: { partyId: p.id, branchNo, ...(addressId ? { id: { not: addressId } } : {}) } }))) return fail(`${back}#addresses`, `Υπάρχει ήδη υποκατάστημα με αριθμό εγκατάστασης ${branchNo}`);
  let point = coords(form, `${back}#addresses`);
  if (point.latitude === null && form.get("locate") === "on") {
    const hit = await geocode(d.data);
    if (hit) point = { latitude: hit.latitude, longitude: hit.longitude };
  }
  const data = { ...d.data, kind, branchNo, ...point };
  if (addressId) await db.partyAddress.updateMany({ where: { id: addressId, partyId: p.id }, data });
  else await db.partyAddress.create({ data: { ...data, partyId: p.id } });
  revalidatePath(back);
  redirect(`${back}?saved=address#addresses`);
}
export async function deleteAddress(partyId: string, addressId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.partyAddress.deleteMany({ where: { id: addressId, partyId: p.id } });
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?saved=address#addresses`);
}

// ---- Επαφές ----
export async function saveContact(partyId: string, contactId: string | null, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const back = `${s.base}/${p.id}`;
  const d = z.object({ name: z.string().trim().min(2, "Γράψε το όνομα της επαφής").max(120), title: text(80), email, phone: text(40), notes: text(300), addressId: text(60) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(`${back}#contacts`, d.error.issues[0].message);
  // η επαφή δένεται μόνο με διεύθυνση του ίδιου συναλλασσόμενου
  const addressId = d.data.addressId && (await db.partyAddress.findFirst({ where: { id: d.data.addressId, partyId: p.id } })) ? d.data.addressId : null;
  const data = { ...d.data, addressId };
  if (contactId) await db.partyContact.updateMany({ where: { id: contactId, partyId: p.id }, data });
  else await db.partyContact.create({ data: { ...data, partyId: p.id } });
  revalidatePath(back);
  redirect(`${back}?saved=contact#contacts`);
}
export async function deleteContact(partyId: string, contactId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.partyContact.deleteMany({ where: { id: contactId, partyId: p.id } });
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?saved=contact#contacts`);
}

// ---- Τραπεζικοί λογαριασμοί ----
export async function saveBank(partyId: string, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const back = `${s.base}/${p.id}`;
  const iban = cleanIban(String(form.get("iban") ?? ""));
  if (!iban) return fail(`${back}#banks`, "Το IBAN δεν είναι έγκυρο. Έλεγξε ότι το έγραψες ολόκληρο (το ελληνικό έχει 27 χαρακτήρες)");
  const d = z.object({ bank: text(80), holder: text(160) }).parse(Object.fromEntries(form));
  if (await db.partyBankAccount.findFirst({ where: { partyId: p.id, iban } })) return fail(`${back}#banks`, "Αυτό το IBAN υπάρχει ήδη στην καρτέλα");
  const first = (await db.partyBankAccount.count({ where: { partyId: p.id } })) === 0;
  await db.partyBankAccount.create({ data: { ...d, iban, partyId: p.id, isPrimary: first } });
  revalidatePath(back);
  redirect(`${back}?saved=bank#banks`);
}
export async function deleteBank(partyId: string, bankId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.partyBankAccount.deleteMany({ where: { id: bankId, partyId: p.id } });
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?saved=bank#banks`);
}
export async function setPrimaryBank(partyId: string, bankId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.$transaction([db.partyBankAccount.updateMany({ where: { partyId: p.id }, data: { isPrimary: false } }), db.partyBankAccount.updateMany({ where: { id: bankId, partyId: p.id }, data: { isPrimary: true } })]);
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?saved=bank#banks`);
}

// ---- Προσωπικά δεδομένα (μόνο για συναλλασσόμενους επιχείρησης· το κλειδί «customer» έμεινε από τους πελάτες) ----
/** Συναίνεση που δόθηκε εκτός εφαρμογής (έντυπο, email, προφορικά): την καταχωρεί ο χρήστης της επιχείρησης. */
export async function setCustomerConsent(id: string, granted: boolean) {
  const { org, user } = await currentOrg("customers.manage");
  const c = await db.party.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/parties");
  await recordConsent({ orgId: org.id, subjectType: "customer", subjectId: c.id, subjectLabel: [c.name, c.email].filter(Boolean).join(" · "), purpose: "customer_marketing", granted, source: "admin", actor: { id: user.id, name: user.name } });
  revalidatePath(`/parties/${id}`);
  redirect(`/parties/${id}?saved=consent#gdpr`);
}

/** Ο συναλλασσόμενος ζήτησε να σβηστούν τα στοιχεία του: ανοίγει αίτημα στο GDPR της επιχείρησης (προθεσμία 30 ημερών). */
export async function requestCustomerErasure(id: string, form: FormData) {
  const { org, user } = await currentOrg("customers.manage");
  const c = await db.party.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/parties");
  const error = await requestErasure({ orgId: org.id, subjectType: "customer", subjectId: c.id, name: c.name, email: c.email, reason: String(form.get("reason") ?? "").trim().slice(0, 500), actor: { id: user.id, name: user.name } }).then(
    () => null,
    (e) => (e instanceof GdprError ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά"),
  );
  revalidatePath(`/parties/${id}`);
  redirect(error ? `/parties/${id}?error=${encodeURIComponent(error)}#gdpr` : `/parties/${id}?saved=erasure#gdpr`);
}
