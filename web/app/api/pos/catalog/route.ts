import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";

const FREQUENT_DAYS = 30;
const FREQUENT_MAX = 12;

export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const categories = await db.category.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { position: "asc" },
    select: {
      id: true, name: true, color: true,
      products: {
        where: { active: true }, orderBy: { name: "asc" },
        select: {
          id: true, name: true, code: true, priceCents: true, vatRate: { select: { rate: true } },
          modifierGroups: {
            orderBy: { position: "asc" },
            select: { pick: true, group: { select: { id: true, name: true, kind: true, options: { where: { active: true }, orderBy: { position: "asc" }, select: { id: true, name: true, priceCents: true } } } } },
          },
        },
      },
    },
  });
  // Η εφαρμογή ταμείου περιμένει το ποσοστό ΦΠΑ ως αριθμό και τις ομάδες επιλογών επίπεδες, με το «πόσες» της σύνδεσης.
  const flat = categories.map((c) => ({
    ...c,
    products: c.products.map((p) => ({
      id: p.id, name: p.name, code: p.code, priceCents: p.priceCents, vatRate: p.vatRate.rate,
      groups: p.modifierGroups.filter((m) => m.group.options.length).map((m) => ({ ...m.group, pick: m.group.kind === "REQUIRED" ? m.pick : 0 })),
    })),
  }));
  // «Συχνά»: τα πιο πουλημένα του καταστήματος τον τελευταίο μήνα, πρώτα στη μπάρα κατηγοριών.
  const top = await db.saleLine.groupBy({
    by: ["productId"],
    where: { sale: { orgId: ctx.org.id, storeId: ctx.store.id, status: "COMPLETED", issuedAt: { gte: new Date(Date.now() - FREQUENT_DAYS * 86_400_000) } } },
    _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: FREQUENT_MAX,
  });
  const frequent = top.map((t) => t.productId).filter((id) => flat.some((c) => c.products.some((p) => p.id === id)));
  // Οι τρόποι πληρωμής του ταμείου, με τη σειρά της κονσόλας: η εφαρμογή στέλνει το id στην πώληση.
  const paymentMethods = await db.paymentMethod.findMany({ where: { active: true, posEnabled: true, payItemCase: { not: null } }, orderBy: { sort: "asc" }, select: { id: true, code: true, name: true } });
  // Τραπέζια και κρατήσεις φαίνονται στο ταμείο μόνο όταν το κατάστημα έχει τραπέζια.
  const hasTables = (await db.diningTable.count({ where: { orgId: ctx.org.id, storeId: ctx.store.id, active: true } })) > 0;
  return Response.json({ device: { name: ctx.device.name, series: ctx.device.series }, store: ctx.store.name, hasTables, categories: flat, frequent, paymentMethods });
}
