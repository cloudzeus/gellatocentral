"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { submitPublicRfq } from "@/lib/rfq-db";

export async function submitQuote(form: FormData) {
  const token = String(form.get("token") ?? "");
  try {
    const ids = form.getAll("rfqLineId").map(String);
    await submitPublicRfq(token, ids.map((rfqLineId) => ({ rfqLineId, unitPriceHundredths: Math.round(Number(String(form.get(`price:${rfqLineId}`) ?? "").replace(",", ".")) * 10000), packagePriceCents: null, unitsPerPackage: null, note: String(form.get(`note:${rfqLineId}`) ?? "") })));
  } catch (error) {
    redirect(`/rfq/${encodeURIComponent(token)}?error=${encodeURIComponent(error instanceof Error ? error.message : "Η υποβολή απέτυχε")}`);
  }
  revalidatePath(`/rfq/${token}`);
  redirect(`/rfq/${encodeURIComponent(token)}?saved=1`);
}
