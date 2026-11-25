"use server";
// Διαχείριση pay-as-you-go υπηρεσιών (OCR κ.ά.): τιμολογιακή πολιτική ανά υπηρεσία.
// Μόνο η πλατφόρμα (billing.edit) — οι συνδρομητές βλέπουν την κατανάλωσή τους στο /billing.

import { flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";

const back = (q: string): never => {
  revalidatePath("/platform/usage");
  redirect(`/platform/usage?${q}`);
};
const fail = (msg: string): never => back(`error=${encodeURIComponent(msg)}`);

const schema = z.object({
  service: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,29}$/, "Το κλειδί: 2–30 μικρά λατινικά, αριθμοί ή παύλες, π.χ. ocr"),
  label: z.string().trim().min(3, "Γράψε πώς λέγεται η υπηρεσία").max(60),
  unitLabel: z.string().trim().min(3, "Γράψε πώς μετράει η χρέωση, π.χ. «ανά έγγραφο»").max(40),
  markupPercent: z.string().trim().max(5),
});

/** Νέα υπηρεσία ή αλλαγή τιμολογιακής πολιτικής. Η χρέωση = κόστος παρόχου × ισοτιμία × (1 + markup). */
export async function saveUsagePrice(form: FormData) {
  await requirePlatform("billing.edit");
  const d = schema.safeParse(Object.fromEntries(form));
  if (!d.success) return fail(d.error.issues[0].message);
  const markupPercent = Number(d.data.markupPercent.replace(",", "."));
  if (!Number.isInteger(markupPercent) || markupPercent < 0 || markupPercent > 500) return fail("Το markup είναι ακέραιο ποσοστό 0–500");
  const active = form.get("active") === "on";
  await db.usagePrice.upsert({
    where: { service: d.data.service },
    update: { label: d.data.label, unitLabel: d.data.unitLabel, markupPercent, active },
    create: { service: d.data.service, label: d.data.label, unitLabel: d.data.unitLabel, markupPercent, active },
  });
  back("saved=1");
}

/** Απενεργοποίηση/ενεργοποίηση: ανενεργή υπηρεσία αρνείται νέες χρήσεις (το ιστορικό μένει). */
export async function toggleUsagePrice(service: string) {
  await requirePlatform("billing.edit");
  const p = await db.usagePrice.findUnique({ where: { service } });
  if (p) await db.usagePrice.update({ where: { service }, data: { active: !p.active } });
  back("saved=1");
}

async function setUsagePricesActive(ids: string[], active: boolean) {
  const parsed = z.array(schema.shape.service).min(1).max(200).safeParse(ids);
  if (!parsed.success) return "Η επιλογή υπηρεσιών δεν είναι έγκυρη";
  await requirePlatform("billing.edit");
  const unique = [...new Set(parsed.data)];
  const result = await db.usagePrice.updateMany({ where: { service: { in: unique } }, data: { active } });
  revalidatePath("/platform/usage");
  if (result.count !== unique.length) return "Ορισμένες υπηρεσίες δεν βρέθηκαν· ανανέωσε τη λίστα";
  const n = unique.length;
  await flashOk(active ? (n === 1 ? "Η υπηρεσία ενεργοποιήθηκε" : `${n} υπηρεσίες ενεργοποιήθηκαν`) : n === 1 ? "Η υπηρεσία απενεργοποιήθηκε" : `${n} υπηρεσίες απενεργοποιήθηκαν`);
}
export async function activateUsagePrices(ids: string[]) {
  return setUsagePricesActive(ids, true);
}
export async function hideUsagePrices(ids: string[]) {
  return setUsagePricesActive(ids, false);
}
