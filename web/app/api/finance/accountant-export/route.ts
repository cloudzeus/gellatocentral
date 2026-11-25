// Λογιστικό πακέτο JSON/CSV με ρητή περίοδο· κάθε λήψη καταγράφεται χωρίς payroll δεδομένα.
import { accountantCsv } from "@/lib/accountant-export";
import { exportAccountantPackage } from "@/lib/accountant-export-db";
import { stockApiContext } from "@/lib/stock-context";
import { workflowMessage } from "@/lib/workflow-db";

export async function GET(request: Request) {
  const access = await stockApiContext("finance.export");
  if ("error" in access) return access.error;
  const query = new URL(request.url).searchParams;
  const format = query.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return Response.json({ error: "Υποστηρίζονται JSON και CSV" }, { status: 400 });
  try {
    const data = await exportAccountantPackage(access.ctx, { from: query.get("from") ?? "", to: query.get("to") ?? "", storeId: query.get("storeId") || null, format });
    const body = format === "csv" ? accountantCsv(data) : JSON.stringify(data, null, 2);
    return new Response(body, { headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="accountant-${data.filters.from}-${data.filters.to}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: workflowMessage(error) }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
