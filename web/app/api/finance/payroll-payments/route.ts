// Payroll preparation/execution· ο generic provider είναι server-configured και από προεπιλογή DISABLED.
import { payrollPaymentsCsv } from "@/lib/payroll-payments";
import { executePayrollPaymentBatch, exportPayrollPaymentBatch, getPayrollPaymentBatch, listPayrollPaymentBatches } from "@/lib/payroll-payments-db";
import { payrollProviderAvailability } from "@/lib/payroll-payment-providers";
import { stockApiContext } from "@/lib/stock-context";
import { runTask } from "@/lib/tasks";
import { workflowMessage } from "@/lib/workflow-db";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const access = await stockApiContext("finance.export");
  if ("error" in access) return access.error;
  if (!access.ctx.can("staff.pay")) return json({ error: "Απαιτείται ειδικό δικαίωμα αμοιβών" }, 403);
  const query = new URL(request.url).searchParams;
  if (query.get("list") === "1") {
    try { return json({ batches: await listPayrollPaymentBatches(access.ctx), provider: payrollProviderAvailability() }); }
    catch (error) { return json({ error: workflowMessage(error) }, 400); }
  }
  const format = query.get("format") ?? "csv";
  if (format !== "json" && format !== "csv") return json({ error: "Υποστηρίζονται JSON και CSV" }, 400);
  try {
    const batchId = query.get("batchId");
    const batch = batchId
      ? await getPayrollPaymentBatch(access.ctx, batchId)
      : await exportPayrollPaymentBatch(access.ctx, { from: query.get("from") ?? "", to: query.get("to") ?? "", storeId: query.get("storeId") || null, format });
    if (format === "json") return json(batch);
    return new Response(payrollPaymentsCsv(batch), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${batch.execution.status}-${batch.filters.from}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return json({ error: workflowMessage(error) }, 400);
  }
}

export async function POST(request: Request) {
  const access = await stockApiContext("finance.export");
  if ("error" in access) return access.error;
  if (!access.ctx.can("staff.pay")) return json({ error: "Απαιτείται ειδικό δικαίωμα αμοιβών" }, 403);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json({ error: "Μη αποδεκτή προέλευση" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 32_768) return json({ error: "Υπερβολικά μεγάλο αίτημα" }, 413);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Μη έγκυρο αίτημα εκτέλεσης" }, 400);
  try {
    // φαίνεται στο παράθυρο «Εργασίες» μόνο σε όσους έχουν το δικαίωμα αμοιβών· χωρίς «Ξανά» από εκεί (lib/task-kinds.ts):
    // μια νέα εκτέλεση θέλει πάλι τη ρητή επιβεβαίωση ποσού της οθόνης
    const execution = await runTask({ orgId: access.ctx.orgId, userId: access.ctx.userId, userName: access.ctx.userName }, { kind: "payroll.execute", title: "Μαζική πληρωμή μισθοδοσίας", permission: "staff.pay" }, async (task) => {
      const result = await executePayrollPaymentBatch(access.ctx, {
        batchId: String(body.batchId ?? ""),
        accountId: String(body.accountId ?? ""),
        clientKey: String(body.clientKey ?? ""),
        confirmation: String(body.confirmation ?? ""),
        confirmedAmountCents: typeof body.confirmedAmountCents === "number" ? body.confirmedAmountCents : Number.NaN,
      });
      // η εκτέλεση επιστρέφει κανονικά και όταν ο πάροχος αρνηθεί ή δεν απαντήσει: το παράθυρο πρέπει να το λέει
      if (result.status === "FAILED") await task.fail({ label: "Εντολή πληρωμής", reason: "Η τράπεζα απέρριψε την εντολή. Καμία πληρωμή δεν έγινε." });
      else if (result.status === "UNCERTAIN") await task.fail({ label: "Εντολή πληρωμής", reason: "Δεν ξέρουμε αν η τράπεζα εκτέλεσε την εντολή. Μην τη στείλεις ξανά: κάνε πρώτα συμψηφισμό στα Οικονομικά." });
      else if (result.status === "SUCCEEDED") await task.ok();
      task.result("/finance");
      return result;
    });
    const batch = await getPayrollPaymentBatch(access.ctx, execution.batchId);
    return json({ execution, batch });
  } catch (error) {
    return json({ error: workflowMessage(error) }, 400);
  }
}
