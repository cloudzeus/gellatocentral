// Persisted CSV reviews· δεν εκτελεί τραπεζική ή αυτόματη ledger εγγραφή.
import { getAccountStatementReview, listAccountStatementReviews, reviewAccountStatement } from "@/lib/finance-reconciliation-db";
import { stockApiContext } from "@/lib/stock-context";
import { runTask } from "@/lib/tasks";
import { workflowMessage } from "@/lib/workflow-db";

const fail = (status: number, message: string) => Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const access = await stockApiContext("finance.read");
  if ("error" in access) return access.error;
  const query = new URL(request.url).searchParams;
  try {
    const reviewId = query.get("reviewId");
    const result = reviewId
      ? await getAccountStatementReview(access.ctx, { accountId: query.get("accountId") ?? "", reviewId })
      : await listAccountStatementReviews(access.ctx, query.get("accountId") || null);
    return json(result);
  } catch (error) {
    return fail(400, workflowMessage(error));
  }
}

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
    const csv = await file.text();
    // η εισαγωγή φαίνεται στο παράθυρο «Εργασίες»· η ίδια η αντιστοίχιση δεν αλλάζει
    const review = await runTask({ orgId: access.ctx.orgId, userId: access.ctx.userId, userName: access.ctx.userName }, { kind: "finance.statement", title: `Εισαγωγή κίνησης τράπεζας${file.name ? ` · ${file.name.slice(0, 60)}` : ""}`, permission: "finance.read" }, async (task) => {
      const result = await reviewAccountStatement(access.ctx, {
        accountId: String(form.get("accountId") ?? ""),
        from: String(form.get("from") ?? ""),
        to: String(form.get("to") ?? ""),
        csv,
        sourceName: file.name,
      });
      task.result("/finance");
      return result;
    });
    return json(review);
  } catch (error) {
    return fail(400, workflowMessage(error));
  }
}
