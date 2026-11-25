// Review μόνο: το αρχείο μένει στο request, δεν αποθηκεύεται και δεν εκτελεί τραπεζική/ledger εγγραφή.
import { reviewAccountStatement } from "@/lib/finance-reconciliation-db";
import { stockApiContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

const fail = (status: number, message: string) => Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  const access = await stockApiContext("finance.read");
  if ("error" in access) return access.error;
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return fail(403, "Μη αποδεκτή προέλευση");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return fail(400, "Επίλεξε CSV statement");
  if (file.size > 1_000_000) return fail(413, "Το statement υπερβαίνει το 1 MB");
  try {
    const review = await reviewAccountStatement(access.ctx, {
      accountId: String(form.get("accountId") ?? ""),
      from: String(form.get("from") ?? ""),
      to: String(form.get("to") ?? ""),
      csv: await file.text(),
    });
    return Response.json(review, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return fail(400, workflowMessage(error));
  }
}
