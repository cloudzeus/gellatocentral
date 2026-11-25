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
import { ensureGeoArea, validGeoIds } from "@/lib/geo";
import { cleanChannel, formDate, isActivityKind, isChannelKind, type ChannelKind } from "@/lib/crm";
import { cleanCoords, cleanEuroCents, cleanIban, cleanNonNegativeInt, cleanRoles, cleanWeekdays, isAddressKind } from "@/lib/parties";
import { activePaymentMethod } from "@/lib/payment-methods";
import { partyScope, type PartyScope } from "@/lib/party-scope";

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const email = text(160).refine((v) => !v || z.string().email().safeParse(v).success, "Το email δεν είναι έγκυρο");
const euroCents = z.string().trim().refine((v) => v === "" || cleanEuroCents(v) !== null, "Το ποσό πρέπει να είναι μη αρνητικό, με το πολύ δύο δεκαδικά και εντός των ορίων του συστήματος").transform((v) => cleanEuroCents(v));
const leadTimeDays = z.string().trim().refine((v) => v === "" || cleanNonNegativeInt(v) !== null, "Οι ημέρες προετοιμασίας πρέπει να είναι μη αρνητικός ακέραιος εντός των ορίων του συστήματος").transform((v) => cleanNonNegativeInt(v));
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
  // Γεωγραφία αναφοράς: κωδικοί Καλλικράτη/πόλης/περιοχής από τα αλληλοεξαρτώμενα πεδία + όνομα νέας περιοχής
  regionCode: text(10),
  cityId: text(30),
  areaId: text(30),
  areaName: text(80).optional().transform((v) => v ?? null),
  paymentTermsDays: z.string().trim().transform((v) => (v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), "Οι ημέρες πίστωσης είναι από 0 έως 365"),
  creditLimitCents: euroCents,
  leadTimeDays,
  minOrderValueCents: euroCents,
  paymentMethodId: text(40), // id τρόπου πληρωμής από την κοινή λίστα (τα seeded είναι «pm_cash»…, όχι cuid)
  notes: text(1000),
});
// το μήνυμα μπαίνει ΠΡΙΝ από το #τμήμα: αλλιώς ο browser το θεωρεί μέρος του και η σελίδα δεν το βλέπει
const fail = (to: string, error: string): never => {
  const [path, hash] = to.split("#");
  return redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}${hash ? `#${hash}` : ""}`);
};
const editor = async (action: "add" | "edit" = "edit"): Promise<PartyScope> => {
  const s = await partyScope();
  if (!s.can(action)) redirect(`${s.base}?error=${encodeURIComponent("Ο ρόλος σου επιτρέπει μόνο προβολή")}`);
  return s;
};
/** Ο συναλλασσόμενος, μόνο αν ανήκει στο αρχείο του χρήστη. */
const owned = async (s: PartyScope, id: string) => (await db.party.findFirst({ where: { id, orgId: s.orgId } })) ?? redirect(s.base);
/** Ασφαλής επιστροφή στη λίστα: δέχεται μόνο URL της λίστας του τρέχοντος πεδίου (όχι καρτέλας, όχι εξωτερικό). */
const safeBack = (s: PartyScope, raw: unknown) => (typeof raw === "string" && (raw === s.base || raw.startsWith(`${s.base}?`)) ? raw : null);
/** Ανακατεύθυνση με μήνυμα επιτυχίας, ακόμα και σε URL χωρίς παραμέτρους. */
const saved = (url: string, key: string): never => redirect(`${url}${url.includes("?") ? "&" : "?"}saved=${key}`);
/** Συντεταγμένες από τη φόρμα: και οι δύο ή καμία. Με κενά πεδία σβήνονται. */
function coords(form: FormData, back: string) {
  const lat = String(form.get("latitude") ?? "").trim(), lng = String(form.get("longitude") ?? "").trim();
  if (!lat && !lng) return { latitude: null, longitude: null };
  return cleanCoords(lat, lng) ?? fail(back, "Οι συντεταγμένες θέλουν και πλάτος και μήκος, π.χ. 37,9838 και 23,7275");
}

/** Νέος συναλλασσόμενος (id = null) ή αλλαγή στοιχείων. Έχει τουλάχιστον έναν ρόλο και μπορεί να έχει πολλούς. */
export async function saveParty(id: string | null, form: FormData) {
  const s = await editor(id ? "edit" : "add");
  const back = id ? `${s.base}/${id}` : s.base;
  const d = schema.safeParse(Object.fromEntries(form));
  if (!d.success) return fail(back, d.error.issues[0].message);
  const orderDays = cleanWeekdays(form.getAll("orderDays")), deliveryDays = cleanWeekdays(form.getAll("deliveryDays"));
  if (orderDays === null || deliveryDays === null) return fail(back, "Οι ημέρες παραγγελίας και παράδοσης πρέπει να είναι έγκυρες ημέρες εβδομάδας");
  // ο τρόπος πληρωμής πρέπει να υπάρχει και να είναι ενεργός στην κοινή λίστα· αλλιώς μένει κενό
  if (d.data.paymentMethodId && !(await activePaymentMethod(d.data.paymentMethodId))) d.data.paymentMethodId = null;
  const { areaName, ...fields } = d.data; // το areaName δεν είναι στήλη: γίνεται περιοχή στην κοινή λίστα
  // Οι κωδικοί γεωγραφίας της φόρμας επιβεβαιώνονται στη βάση· χωρίς κωδικούς γίνεται ταίριασμα
  // από το κείμενο. Μόνο για Ελλάδα: αλλού ο Καλλικράτης δεν εφαρμόζεται.
  const geo = fields.countryCode === "GR" ? await validGeoIds({ regionCode: fields.regionCode, cityId: fields.cityId, areaId: fields.areaId, cityText: fields.city, regionText: fields.region }) : { regionCode: null, cityId: null, areaId: null };
  const areaId = geo.areaId ?? (await ensureGeoArea(geo.cityId, areaName, { postalCode: fields.postalCode, source: "manual" }));
  const roles = cleanRoles(form.getAll("roles"));
  if (!roles.length) return fail(back, "Διάλεξε τουλάχιστον έναν ρόλο: πελάτης, προμηθευτής, franchisee ή συνεργάτης");
  const vat = d.data.countryCode === "GR" ? d.data.vatNumber?.replace(/^(EL|GR)/, "") ?? null : d.data.vatNumber;
  if (vat && d.data.countryCode === "GR" && !validAfm(vat)) return fail(back, "Το ΑΦΜ δεν είναι έγκυρο (9 ψηφία με σωστό ψηφίο ελέγχου)");
  if (vat && (await db.party.findFirst({ where: { orgId: s.orgId, vatNumber: vat, ...(id ? { id: { not: id } } : {}) } }))) return fail(back, `Υπάρχει ήδη συναλλασσόμενος με ΑΦΜ ${vat}. Άνοιξε την καρτέλα του και πρόσθεσέ του τον ρόλο`);
  // «επιβεβαιώθηκε από το μητρώο» ισχύει μόνο αν η φόρμα το δηλώνει ΚΑΙ το ΑΦΜ δεν άλλαξε μετά την αναζήτηση
  const checked = form.get("vatCheckedFor") === `${d.data.countryCode}${vat ?? ""}` && vat ? { vatCheckedAt: new Date() } : {};
  const data = { ...fields, vatNumber: vat, roles, orderDays, deliveryDays, ...coords(form, back), ...checked, regionCode: geo.regionCode, cityId: geo.cityId, areaId };
  if (id) {
    const before = await owned(s, id);
    await db.party.update({ where: { id: before.id }, data: before.vatNumber !== vat && !("vatCheckedAt" in checked) ? { ...data, vatCheckedAt: null } : data });
    await adoptPrimary(before.id, d.data);
    revalidatePath(back);
    redirect(`${back}?tab=details&saved=1`);
  }
  const created = await db.party.create({ data: { ...data, orgId: s.orgId } });
  await adoptPrimary(created.id, d.data);
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
  if (!hit) return fail(`${s.base}/${id}?tab=places`, "Η διεύθυνση δεν βρέθηκε στον χάρτη. Έλεγξε οδό και πόλη, ή βάλε την πινέζα με το χέρι από το «Αλλαγή»");
  await db.party.update({ where: { id: p.id }, data: { latitude: hit.latitude, longitude: hit.longitude, geocodedAt: new Date() } });
  revalidatePath(`${s.base}/${id}`);
  redirect(`${s.base}/${id}?tab=places&saved=located`);
}

// ---- Υποκαταστήματα και διευθύνσεις ----
const addressSchema = z.object({
  label: text(80),
  street: z.string().trim().min(2, "Γράψε τη διεύθυνση").max(200),
  city: text(80),
  postalCode: text(10),
  region: text(80),
  regionCode: text(10),
  cityId: text(30),
  areaId: text(30),
  areaName: text(80).optional().transform((v) => v ?? null),
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
  if (!d.success) return fail(`${back}?tab=places`, d.error.issues[0].message);
  const kind = form.get("kind");
  if (!isAddressKind(kind)) return fail(`${back}?tab=places`, "Διάλεξε είδος διεύθυνσης");
  // αριθμό εγκατάστασης έχουν μόνο τα υποκαταστήματα, και είναι μοναδικός ανά συναλλασσόμενο
  const branchNo = kind === "branch" ? d.data.branchNo : null;
  if (branchNo && (await db.partyAddress.findFirst({ where: { partyId: p.id, branchNo, ...(addressId ? { id: { not: addressId } } : {}) } }))) return fail(`${back}?tab=places`, `Υπάρχει ήδη υποκατάστημα με αριθμό εγκατάστασης ${branchNo}`);
  let point = coords(form, `${back}?tab=places`);
  let locatedAt: Date | null = null;
  if (point.latitude === null && form.get("locate") === "on") {
    const hit = await geocode(d.data);
    if (hit) {
      point = { latitude: hit.latitude, longitude: hit.longitude };
      locatedAt = new Date();
    }
  }
  const { areaName, ...fields } = d.data;
  const geo = fields.countryCode === "GR" ? await validGeoIds({ regionCode: fields.regionCode, cityId: fields.cityId, areaId: fields.areaId, cityText: fields.city, regionText: fields.region }) : { regionCode: null, cityId: null, areaId: null };
  const areaId = geo.areaId ?? (await ensureGeoArea(geo.cityId, areaName, { postalCode: fields.postalCode, latitude: point.latitude, longitude: point.longitude, source: "manual" }));
  const data = { ...fields, kind, branchNo, ...point, regionCode: geo.regionCode, cityId: geo.cityId, areaId, ...(locatedAt ? { geocodedAt: locatedAt } : {}) };
  if (addressId) await db.partyAddress.updateMany({ where: { id: addressId, partyId: p.id }, data });
  else await db.partyAddress.create({ data: { ...data, partyId: p.id } });
  revalidatePath(back);
  redirect(`${back}?tab=places&saved=address`);
}
export async function deleteAddress(partyId: string, addressId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.partyAddress.deleteMany({ where: { id: addressId, partyId: p.id } });
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?tab=places&saved=address`);
}

// ---- Τηλέφωνα και email ----
/** Το κύριο τηλέφωνο και email της εταιρίας αντιγράφονται στο Party (παραστατικά, αναζήτηση). Αν λείπει κύριο, γίνεται το πρώτο. */
async function resyncPrimary(partyId: string) {
  for (const kind of ["phone", "email"] as const) {
    const rows = await db.partyChannel.findMany({ where: { partyId, kind }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }] });
    if (rows[0] && !rows[0].isPrimary) await db.partyChannel.update({ where: { id: rows[0].id }, data: { isPrimary: true } });
    await db.party.update({ where: { id: partyId }, data: { [kind]: rows[0]?.value ?? null } });
  }
}
/** Το τηλέφωνο και το email της φόρμας στοιχείων γίνονται τα κύρια κανάλια· με άδειο πεδίο το κύριο σβήνεται. */
async function adoptPrimary(partyId: string, form: { phone: string | null; email: string | null }) {
  for (const kind of ["phone", "email"] as const) {
    const value = form[kind] ? cleanChannel(kind, form[kind]) ?? form[kind] : null;
    if (!value) { await db.partyChannel.deleteMany({ where: { partyId, kind, isPrimary: true } }); continue; }
    await db.partyChannel.updateMany({ where: { partyId, kind }, data: { isPrimary: false } });
    const row = await db.partyChannel.findFirst({ where: { partyId, kind, value } });
    if (row) await db.partyChannel.update({ where: { id: row.id }, data: { isPrimary: true } });
    else await db.partyChannel.create({ data: { partyId, kind, value, isPrimary: true } });
  }
  await resyncPrimary(partyId);
}
/** Το κανάλι, μόνο αν ανήκει στον συναλλασσόμενο ή σε πρόσωπο που είναι επαφή του. */
const ownedChannel = async (partyId: string, id: string) => db.partyChannel.findFirst({ where: { id, OR: [{ partyId }, { person: { links: { some: { partyId } } } }] } });

export async function saveChannel(partyId: string, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  // από το modal της λίστας η φόρμα φέρει κρυφό `back`, αλλιώς γυρνάμε στην καρτέλα
  const back = safeBack(s, form.get("back")) ?? `${s.base}/${p.id}?tab=contacts`;
  const kind = form.get("kind");
  if (!isChannelKind(kind)) return fail(back, "Διάλεξε τηλέφωνο ή email");
  const value = cleanChannel(kind, String(form.get("value") ?? ""));
  if (!value) return fail(back, kind === "email" ? "Το email δεν είναι έγκυρο" : "Το τηλέφωνο θέλει 6 έως 15 ψηφία, π.χ. 210 1234567");
  const label = String(form.get("label") ?? "").trim().slice(0, 40) || null;
  const personId = String(form.get("personId") ?? "") || null;
  if (personId) {
    if (!(await db.partyContact.findFirst({ where: { partyId: p.id, personId } }))) return fail(back, "Η επαφή δεν βρέθηκε");
    if (!(await db.partyChannel.findFirst({ where: { personId, kind, value } }))) await db.partyChannel.create({ data: { personId, kind, value, label, isPrimary: (await db.partyChannel.count({ where: { personId, kind } })) === 0 } });
  } else {
    const addressId = String(form.get("addressId") ?? "");
    const address = addressId ? await db.partyAddress.findFirst({ where: { id: addressId, partyId: p.id } }) : null;
    if (!(await db.partyChannel.findFirst({ where: { partyId: p.id, kind, value } }))) await db.partyChannel.create({ data: { partyId: p.id, kind, value, label, addressId: address?.id ?? null } });
    await resyncPrimary(p.id);
  }
  revalidatePath(s.base, "layout");
  saved(back, "channel");
}
export async function deleteChannel(partyId: string, channelId: string, form?: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const c = await ownedChannel(p.id, channelId);
  if (c) { await db.partyChannel.delete({ where: { id: c.id } }); if (c.partyId) await resyncPrimary(p.id); }
  revalidatePath(s.base, "layout");
  saved(safeBack(s, form?.get("back")) ?? `${s.base}/${p.id}?tab=contacts`, "channel");
}
export async function primaryChannel(partyId: string, channelId: string, form?: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const c = await ownedChannel(p.id, channelId);
  if (c) {
    await db.$transaction([db.partyChannel.updateMany({ where: { kind: c.kind, ...(c.partyId ? { partyId: c.partyId } : { personId: c.personId }) }, data: { isPrimary: false } }), db.partyChannel.update({ where: { id: c.id }, data: { isPrimary: true } })]);
    if (c.partyId) await resyncPrimary(p.id);
  }
  revalidatePath(s.base, "layout");
  saved(safeBack(s, form?.get("back")) ?? `${s.base}/${p.id}?tab=contacts`, "channel");
}

// ---- Επαφές: πρόσωπα που δένουν με έναν ή περισσότερους συναλλασσόμενους ----
/** Η κύρια επαφή γράφεται και στο Party.contactName (αναζήτηση, λίστα). */
const syncContactName = async (partyId: string) => {
  const main = await db.partyContact.findFirst({ where: { partyId, isPrimary: true, active: true }, include: { person: true } });
  if (main) await db.party.update({ where: { id: partyId }, data: { contactName: main.person.name } });
};
export async function saveContact(partyId: string, contactId: string | null, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const back = safeBack(s, form.get("back")) ?? `${s.base}/${p.id}?tab=contacts`;
  const d = z.object({ name: z.string().trim().max(120), title: text(80), notes: text(300), addressId: text(60), personId: text(60).optional().transform((v) => v ?? null), phone: text(40).optional().transform((v) => v ?? null), email: text(160).optional().transform((v) => v ?? null) }).safeParse(Object.fromEntries(form));
  if (!d.success) return fail(back, d.error.issues[0].message);
  // η επαφή δένεται μόνο με διεύθυνση του ίδιου συναλλασσόμενου
  const addressId = d.data.addressId && (await db.partyAddress.findFirst({ where: { id: d.data.addressId, partyId: p.id } })) ? d.data.addressId : null;
  const link = { title: d.data.title, notes: d.data.notes, addressId };
  if (contactId) {
    const c = await db.partyContact.findFirst({ where: { id: contactId, partyId: p.id } });
    if (!c) return fail(back, "Η επαφή δεν βρέθηκε");
    if (d.data.name.length < 2) return fail(back, "Γράψε το όνομα της επαφής");
    await db.$transaction([db.partyContact.update({ where: { id: c.id }, data: link }), db.person.update({ where: { id: c.personId }, data: { name: d.data.name } })]);
    await syncContactName(p.id);
  } else {
    // υπάρχον πρόσωπο του ίδιου αρχείου (π.χ. ο λογιστής άλλου πελάτη) ή νέο
    let personId = d.data.personId && (await db.person.findFirst({ where: { id: d.data.personId, orgId: s.orgId } }))?.id;
    if (personId && (await db.partyContact.findFirst({ where: { partyId: p.id, personId } }))) return fail(back, "Αυτό το πρόσωπο είναι ήδη επαφή εδώ");
    if (!personId) {
      if (d.data.name.length < 2) return fail(back, "Γράψε το όνομα της επαφής, ή διάλεξε υπάρχον πρόσωπο");
      const channels = (["phone", "email"] as ChannelKind[]).flatMap((kind) => { const raw = d.data[kind]; if (!raw) return []; const value = cleanChannel(kind, raw); return value ? [{ kind, value, isPrimary: true }] : [null]; });
      if (channels.includes(null)) return fail(back, "Το τηλέφωνο ή το email της επαφής δεν είναι έγκυρο");
      personId = (await db.person.create({ data: { orgId: s.orgId, name: d.data.name, channels: { create: channels.filter((c) => c !== null) } } })).id;
    }
    const first = (await db.partyContact.count({ where: { partyId: p.id } })) === 0;
    await db.partyContact.create({ data: { ...link, partyId: p.id, personId, isPrimary: first } });
    if (first) await syncContactName(p.id);
  }
  revalidatePath(s.base, "layout");
  saved(back, "contact");
}
/** Λύνει τη σχέση με αυτόν τον συναλλασσόμενο. Το πρόσωπο σβήνεται μόνο αν δεν έχει άλλη εταιρία ούτε ιστορικό. */
export async function deleteContact(partyId: string, contactId: string, form?: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const c = await db.partyContact.findFirst({ where: { id: contactId, partyId: p.id } });
  if (c) {
    await db.partyContact.delete({ where: { id: c.id } });
    const [links, history] = await Promise.all([db.partyContact.count({ where: { personId: c.personId } }), db.partyActivity.count({ where: { personId: c.personId } })]);
    if (!links && !history) await db.person.delete({ where: { id: c.personId } });
  }
  revalidatePath(s.base, "layout");
  saved(safeBack(s, form?.get("back")) ?? `${s.base}/${p.id}?tab=contacts`, "contact");
}
/** «Κύρια επαφή» (μία ανά συναλλασσόμενο) ή «δεν εργάζεται πλέον εδώ». */
export async function flagContact(partyId: string, contactId: string, what: "primary" | "active") {
  const s = await editor();
  const p = await owned(s, partyId);
  const c = await db.partyContact.findFirst({ where: { id: contactId, partyId: p.id } });
  if (c && what === "active") await db.partyContact.update({ where: { id: c.id }, data: { active: !c.active, isPrimary: c.active ? false : c.isPrimary } });
  if (c && what === "primary") await db.$transaction([db.partyContact.updateMany({ where: { partyId: p.id }, data: { isPrimary: false } }), db.partyContact.update({ where: { id: c.id }, data: { isPrimary: true, active: true } })]);
  await syncContactName(p.id);
  revalidatePath(s.base, "layout");
  redirect(`${s.base}/${p.id}?tab=contacts&saved=contact`);
}

// ---- Ενέργειες CRM: σημείωση, κλήση, email, συνάντηση, εργασία ----
// Δεν ανακατευθύνουν: καλούνται από τη λίστα, το πλαϊνό πάνελ και την καρτέλα, και ο χρήστης μένει εκεί που ήταν.
export async function logActivity(partyId: string, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const kind = form.get("kind");
  // τα πεδία αλλάζουν ανά είδος ενέργειας: όποιο λείπει από τη φόρμα μετρά ως κενό
  const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
  const d = z.object({ subject: opt(160), body: opt(4000), personId: opt(60), direction: opt(3), dueAt: opt(10), durationMin: opt(4) }).safeParse(Object.fromEntries(form));
  if (!isActivityKind(kind) || !d.success || !(d.data.subject || d.data.body)) return fail(`${s.base}/${p.id}`, "Γράψε τι έγινε ή τι πρέπει να γίνει");
  const personId = d.data.personId && (await db.partyContact.findFirst({ where: { partyId: p.id, personId: d.data.personId } })) ? d.data.personId : null;
  const minutes = Number(d.data.durationMin);
  await db.partyActivity.create({
    data: {
      orgId: s.orgId, partyId: p.id, personId, kind, subject: d.data.subject, body: d.data.body, userId: s.actor.id, userName: s.actor.name,
      direction: kind === "call" || kind === "email" ? (d.data.direction === "in" ? "in" : "out") : null,
      dueAt: kind === "task" ? formDate(d.data.dueAt) : null,
      durationMin: kind === "call" || kind === "meeting" ? (Number.isInteger(minutes) && minutes > 0 && minutes < 1000 ? minutes : null) : null,
    },
  });
  revalidatePath(s.base, "layout");
}
/** Αλλαγή σε ενέργεια: ολοκλήρωση εργασίας (ή αναίρεση), καρφίτσωμα, διαγραφή. Μόνο όσες έγραψε άνθρωπος σβήνονται. */
export async function touchActivity(partyId: string, activityId: string, what: "done" | "pin" | "delete") {
  const s = await editor();
  const p = await owned(s, partyId);
  const a = await db.partyActivity.findFirst({ where: { id: activityId, partyId: p.id } });
  if (a && what === "done" && a.kind === "task") await db.partyActivity.update({ where: { id: a.id }, data: { doneAt: a.doneAt ? null : new Date() } });
  if (a && what === "pin") await db.partyActivity.update({ where: { id: a.id }, data: { pinned: !a.pinned } });
  if (a && what === "delete" && a.source === "manual") await db.partyActivity.delete({ where: { id: a.id } });
  revalidatePath(s.base, "layout");
}

// ---- Τραπεζικοί λογαριασμοί ----
export async function saveBank(partyId: string, form: FormData) {
  const s = await editor();
  const p = await owned(s, partyId);
  const back = `${s.base}/${p.id}`;
  const iban = cleanIban(String(form.get("iban") ?? ""));
  if (!iban) return fail(`${back}?tab=details#banks`, "Το IBAN δεν είναι έγκυρο. Έλεγξε ότι το έγραψες ολόκληρο (το ελληνικό έχει 27 χαρακτήρες)");
  const d = z.object({ bank: text(80), holder: text(160) }).parse(Object.fromEntries(form));
  if (await db.partyBankAccount.findFirst({ where: { partyId: p.id, iban } })) return fail(`${back}?tab=details#banks`, "Αυτό το IBAN υπάρχει ήδη στην καρτέλα");
  const first = (await db.partyBankAccount.count({ where: { partyId: p.id } })) === 0;
  await db.partyBankAccount.create({ data: { ...d, iban, partyId: p.id, isPrimary: first } });
  revalidatePath(back);
  redirect(`${back}?tab=details&saved=bank#banks`);
}
export async function deleteBank(partyId: string, bankId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.partyBankAccount.deleteMany({ where: { id: bankId, partyId: p.id } });
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?tab=details&saved=bank#banks`);
}
export async function setPrimaryBank(partyId: string, bankId: string) {
  const s = await editor();
  const p = await owned(s, partyId);
  await db.$transaction([db.partyBankAccount.updateMany({ where: { partyId: p.id }, data: { isPrimary: false } }), db.partyBankAccount.updateMany({ where: { id: bankId, partyId: p.id }, data: { isPrimary: true } })]);
  revalidatePath(`${s.base}/${p.id}`);
  redirect(`${s.base}/${p.id}?tab=details&saved=bank#banks`);
}

// ---- Προσωπικά δεδομένα (μόνο για συναλλασσόμενους επιχείρησης· το κλειδί «customer» έμεινε από τους πελάτες) ----
/** Συναίνεση που δόθηκε εκτός εφαρμογής (έντυπο, email, προφορικά): την καταχωρεί ο χρήστης της επιχείρησης. */
export async function setCustomerConsent(id: string, granted: boolean) {
  const { org, user } = await currentOrg("parties.edit");
  const c = await db.party.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/parties");
  await recordConsent({ orgId: org.id, subjectType: "customer", subjectId: c.id, subjectLabel: [c.name, c.email].filter(Boolean).join(" · "), purpose: "customer_marketing", granted, source: "admin", actor: { id: user.id, name: user.name } });
  revalidatePath(`/parties/${id}`);
  redirect(`/parties/${id}?tab=details&saved=consent#gdpr`);
}

/** Ο συναλλασσόμενος ζήτησε να σβηστούν τα στοιχεία του: ανοίγει αίτημα στο GDPR της επιχείρησης (προθεσμία 30 ημερών). */
export async function requestCustomerErasure(id: string, form: FormData) {
  const { org, user } = await currentOrg("parties.edit");
  const c = await db.party.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/parties");
  const error = await requestErasure({ orgId: org.id, subjectType: "customer", subjectId: c.id, name: c.name, email: c.email, reason: String(form.get("reason") ?? "").trim().slice(0, 500), actor: { id: user.id, name: user.name } }).then(
    () => null,
    (e) => (e instanceof GdprError ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά"),
  );
  revalidatePath(`/parties/${id}`);
  redirect(error ? `/parties/${id}?tab=details&error=${encodeURIComponent(error)}#gdpr` : `/parties/${id}?tab=details&saved=erasure#gdpr`);
}
