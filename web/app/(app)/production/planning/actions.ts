"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { redirectUrl } from "@/lib/flash";
import { createProductionSchedule } from "@/lib/production-workflow-db";
import { STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "@/lib/stock-scope";
import { WorkflowError } from "@/lib/workflow-db";
import { requireStockContext } from "@/lib/stock-context";

const plan = z.object({ recipeId: z.string().min(1).max(64), grams: z.coerce.number().int().min(1).max(10_000_000), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * «Στο πρόγραμμα»: ένα ή περισσότερα πλάνα παραγωγής από την πρόταση. Κάθε γραμμή της φόρμας είναι
 * «recipeId|γραμμάρια μίγματος|ημέρα». Ο έλεγχος δικαιωμάτων/αποθηκών γίνεται στο createProductionSchedule.
 */
export async function schedulePlans(labWarehouseId: string, back: string, form: FormData) {
  const ctx = await requireStockContext("production.add");
  const rows = form.getAll("plan").map(String).slice(0, 100).map((raw) => {
    const [recipeId, grams, day] = raw.split("|");
    return plan.safeParse({ recipeId, grams, day });
  });
  const safeBack = back.startsWith("/production/planning") ? back : "/production/planning";
  const join = safeBack.includes("?") ? "&" : "?";
  if (!rows.length || rows.some((r) => !r.success)) redirect(redirectUrl(`${safeBack}${join}error=Άκυρη πρόταση· ανανέωσε τη σελίδα`));
  let done = 0;
  let message = "";
  for (const row of rows) {
    if (!row.success) continue;
    try {
      // μεσημέρι UTC: ίδια ημέρα Αθήνας όποια ώρα κι αν είναι
      await createProductionSchedule(ctx, { recipeId: row.data.recipeId, sourceWarehouseId: labWarehouseId, destinationWarehouseId: labWarehouseId, plannedFor: new Date(`${row.data.day}T12:00:00.000Z`), quantityGrams: row.data.grams, note: "Από την πρόταση σχεδιασμού" });
      done += 1;
    } catch (error) {
      // μόνο τα δικά μας μηνύματα στην οθόνη· τα απρόβλεπτα σφάλματα ανεβαίνουν όπως πριν
      if (error instanceof WorkflowError) message = error.message;
      else if (error instanceof StockScopeError) message = STOCK_SCOPE_ERROR_MESSAGE[error.code];
      else throw error;
      break;
    }
  }
  revalidatePath("/production/planning");
  revalidatePath("/production/plans");
  if (message) redirect(redirectUrl(`${safeBack}${join}error=${done ? `Μπήκαν ${done}· σταμάτησε: ` : ""}${message}`));
  redirect(redirectUrl(`${safeBack}${join}saved=${done === 1 ? "Μπήκε στο πρόγραμμα παραγωγής" : `Μπήκαν ${done} στο πρόγραμμα παραγωγής`}`));
}
