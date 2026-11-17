import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";

export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const categories = await db.category.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { position: "asc" },
    select: { id: true, name: true, products: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, priceCents: true, vatRate: true } } },
  });
  return Response.json({ device: { name: ctx.device.name, series: ctx.device.series }, store: ctx.store.name, categories });
}
