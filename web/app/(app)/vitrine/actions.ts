"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStockContext } from "@/lib/stock-context";
import { rotateVitrineToken, saveVitrineSetting, syncVitrineItems, updateVitrineItem } from "@/lib/vitrine-db";
import { workflowMessage } from "@/lib/workflow-db";

const back = (query = ""): never => { revalidatePath("/vitrine"); redirect(`/vitrine${query}`); };
const fail = (error: unknown): never => back(`?error=${encodeURIComponent(workflowMessage(error))}`);

export async function saveVitrine(form: FormData) {
  const ctx = await requireStockContext("vitrine.edit");
  const storeId = String(form.get("storeId") ?? "");
  try {
    await saveVitrineSetting(ctx, { storeId, published: form.get("published") === "on", selectionMode: String(form.get("selectionMode") ?? "manual"), warehouseId: String(form.get("warehouseId") ?? "") || null, languages: form.getAll("languages").map(String), showPrices: form.get("showPrices") === "on", showAllergens: form.get("showAllergens") === "on", tvPageSeconds: Number(form.get("tvPageSeconds") ?? 12) });
    await syncVitrineItems(ctx, storeId);
    back("?saved=Η βιτρίνα και τα snapshots ενημερώθηκαν");
  } catch (error) { fail(error); }
}

export async function syncVitrine(storeId: string) {
  const ctx = await requireStockContext("vitrine.edit");
  try { await syncVitrineItems(ctx, storeId); back("?saved=Τα προϊόντα και η διαθεσιμότητα συγχρονίστηκαν"); } catch (error) { fail(error); }
}

export async function saveVitrineItem(form: FormData) {
  const ctx = await requireStockContext("vitrine.edit");
  try {
    const price = String(form.get("price") ?? "").trim();
    await updateVitrineItem(ctx, { itemId: String(form.get("itemId") ?? ""), selected: form.get("selected") === "on", soldOut: form.get("soldOut") === "on", position: Number(form.get("position") ?? 0), priceCents: price ? Math.round(Number(price.replace(",", ".")) * 100) : null });
    back("?saved=Το προϊόν βιτρίνας ενημερώθηκε");
  } catch (error) { fail(error); }
}

export async function issueVitrineLink(storeId: string) {
  const ctx = await requireStockContext("vitrine.edit");
  try { const result = await rotateVitrineToken(ctx, storeId); revalidatePath("/vitrine"); return { token: result.token, error: null as string | null }; }
  catch (error) { return { token: null, error: workflowMessage(error) }; }
}
