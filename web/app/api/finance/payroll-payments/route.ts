// Payroll preparation/execution· ο generic provider είναι server-configured και από προεπιλογή DISABLED.
import { payrollPaymentsCsv } from "@/lib/payroll-payments";
import { executePayrollPaymentBatch, exportPayrollPaymentBatch, getPayrollPaymentBatch, listPayrollPaymentBatches } from "@/lib/payroll-payments-db";
import { payrollProviderAvailability } from "@/lib/payroll-payment-providers";
import { stockApiContext } from "@/lib/stock-context";
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
    const execution = await executePayrollPaymentBatch(access.ctx, {
      batchId: String(body.batchId ?? ""),
      accountId: String(body.accountId ?? ""),
      clientKey: String(body.clientKey ?? ""),
      confirmation: String(body.confirmation ?? ""),
      confirmedAmountCents: typeof body.confirmedAmountCents === "number" ? body.confirmedAmountCents : Number.NaN,
    });
    const batch = await getPayrollPaymentBatch(access.ctx, execution.batchId);
    return json({ execution, batch });
  } catch (error) {
    return json({ error: workflowMessage(error) }, 400);
  }
}
