// Αρχείο προετοιμασίας μισθοδοσίας· δεν είναι SEPA/τραπεζική εντολή και δεν δηλώνει εκτέλεση πληρωμής.
import { payrollPaymentsCsv } from "@/lib/payroll-payments";
import { exportPayrollPaymentBatch } from "@/lib/payroll-payments-db";
import { stockApiContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

export async function GET(request: Request) {
  const access = await stockApiContext("finance.export");
  if ("error" in access) return access.error;
  if (!access.ctx.can("staff.pay")) return Response.json({ error: "Απαιτείται ειδικό δικαίωμα αμοιβών" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const format = query.get("format") ?? "csv";
  if (format !== "json" && format !== "csv") return Response.json({ error: "Υποστηρίζονται JSON και CSV" }, { status: 400 });
  try {
    const batch = await exportPayrollPaymentBatch(access.ctx, { from: query.get("from") ?? "", to: query.get("to") ?? "", storeId: query.get("storeId") || null, format });
    const body = format === "csv" ? payrollPaymentsCsv(batch) : JSON.stringify(batch, null, 2);
    return new Response(body, { headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-preparation-NOT-EXECUTED-${batch.filters.from}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: workflowMessage(error) }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
