import { billDetail } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";

// Ο λογαριασμός με τις αποστολές του και, ανά γραμμή, τι πληρώθηκε και τι μένει.
export async function GET(req: Request, { params }: RouteContext<"/api/pos/bills/[id]">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const bill = await billDetail(ctx, (await params).id);
  return bill ? Response.json(bill) : Response.json({ error: "not_found" }, { status: 404 });
}
