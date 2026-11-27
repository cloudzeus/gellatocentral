// CSV του ημερολογίου διαβιβάσεων για έλεγχο (λογιστής, ΑΑΔΕ). Ίδια φίλτρα με την οθόνη /transmissions.
import { attemptsCsv, DOC_TYPES, STATUSES } from "@/lib/fiscal-log";
import { stockApiContext } from "@/lib/stock-context";
import type { FiscalStatus } from "@/lib/generated/prisma/client";

export async function GET(request: Request) {
  const access = await stockApiContext("invoices.read");
  if ("error" in access) return access.error;
  const query = new URL(request.url).searchParams;
  const type = query.get("type");
  const status = query.get("status") as FiscalStatus | null;
  const csv = await attemptsCsv({
    orgId: access.ctx.orgId,
    docType: type && type in DOC_TYPES ? type : null,
    status: status && STATUSES.includes(status) ? status : null,
    q: (query.get("q") ?? "").trim().slice(0, 80),
  });
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="diavivaseis-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
