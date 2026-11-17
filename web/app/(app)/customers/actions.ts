"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validAfm } from "@/lib/afm";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { GdprError, recordConsent, requestErasure } from "@/lib/gdpr";

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const schema = z.object({
  name: z.string().trim().min(2, "Γράψε την επωνυμία ή το ονοματεπώνυμο").max(160),
  tradeName: text(160),
  vatNumber: text(9).refine((v) => !v || validAfm(v), "Το ΑΦΜ δεν είναι έγκυρο (9 ψηφία)"),
  taxOffice: text(80),
  profession: text(120),
  contactName: text(120),
  email: text(160).refine((v) => !v || z.string().email().safeParse(v).success, "Το email δεν είναι έγκυρο"),
  phone: text(40),
  address: text(200),
  city: text(80),
  postalCode: text(10),
  paymentTermsDays: z.string().trim().transform((v) => (v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), "Οι ημέρες πίστωσης είναι από 0 έως 365"),
  notes: text(1000),
});
const fail = (to: string, error: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);

/** Νέος πελάτης (id = null) ή αλλαγή στοιχείων. */
export async function saveCustomer(id: string | null, form: FormData) {
  const { org } = await currentOrg("customers.manage");
  const back = id ? `/customers/${id}` : "/customers";
  const d = schema.safeParse(Object.fromEntries(form));
  if (!d.success) return fail(back, d.error.issues[0].message);
  if (d.data.vatNumber && (await db.customer.findFirst({ where: { orgId: org.id, vatNumber: d.data.vatNumber, ...(id ? { id: { not: id } } : {}) } }))) return fail(back, `Υπάρχει ήδη πελάτης με ΑΦΜ ${d.data.vatNumber}`);
  if (id) {
    // updateMany με orgId: κανείς δεν αλλάζει πελάτη άλλης επιχείρησης, ακόμα κι αν μαντέψει το id
    const { count } = await db.customer.updateMany({ where: { id, orgId: org.id }, data: d.data });
    if (!count) redirect("/customers");
    revalidatePath(back);
    redirect(`${back}?saved=1`);
  }
  const created = await db.customer.create({ data: { ...d.data, orgId: org.id } });
  redirect(`/customers/${created.id}?saved=1`);
}

export async function toggleCustomer(id: string) {
  const { org } = await currentOrg("customers.manage");
  const c = await db.customer.findFirst({ where: { id, orgId: org.id } });
  if (c) await db.customer.update({ where: { id: c.id }, data: { active: !c.active } });
  revalidatePath("/customers");
}

/** Συναίνεση του πελάτη που δόθηκε εκτός εφαρμογής (έντυπο, email, προφορικά): την καταχωρεί ο χρήστης της επιχείρησης. */
export async function setCustomerConsent(id: string, granted: boolean) {
  const { org, user } = await currentOrg("customers.manage");
  const c = await db.customer.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/customers");
  await recordConsent({ orgId: org.id, subjectType: "customer", subjectId: c.id, subjectLabel: [c.name, c.email].filter(Boolean).join(" · "), purpose: "customer_marketing", granted, source: "admin", actor: { id: user.id, name: user.name } });
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}?saved=consent#gdpr`);
}

/** Ο πελάτης ζήτησε να σβηστούν τα στοιχεία του: ανοίγει αίτημα στο GDPR της επιχείρησης (προθεσμία 30 ημερών). */
export async function requestCustomerErasure(id: string, form: FormData) {
  const { org, user } = await currentOrg("customers.manage");
  const c = await db.customer.findFirst({ where: { id, orgId: org.id } });
  if (!c) redirect("/customers");
  const error = await requestErasure({ orgId: org.id, subjectType: "customer", subjectId: c.id, name: c.name, email: c.email, reason: String(form.get("reason") ?? "").trim().slice(0, 500), actor: { id: user.id, name: user.name } }).then(
    () => null,
    (e) => (e instanceof GdprError ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά"),
  );
  revalidatePath(`/customers/${id}`);
  redirect(error ? `/customers/${id}?error=${encodeURIComponent(error)}#gdpr` : `/customers/${id}?saved=erasure#gdpr`);
}
