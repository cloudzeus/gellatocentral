import { db } from "@/lib/db";
import { soldOutIds } from "@/lib/bills";
import { tillFromRequest } from "@/lib/device-auth";
import { tillCatalog } from "@/lib/pos-catalog";

export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  // «Συχνά»: τα πιο πουλημένα του καταστήματος τον τελευταίο μήνα, πρώτα στη μπάρα κατηγοριών.
  const { categories: flat, frequent } = await tillCatalog(ctx.org.id, ctx.store.id);
  // Οι τρόποι πληρωμής του ταμείου, με τη σειρά της κονσόλας: η εφαρμογή στέλνει το id στην πώληση.
  const paymentMethods = await db.paymentMethod.findMany({ where: { active: true, posEnabled: true, payItemCase: { not: null } }, orderBy: { sort: "asc" }, select: { id: true, code: true, name: true, payItemCase: true } });
  // Τραπέζια και κρατήσεις φαίνονται στο ταμείο μόνο όταν το κατάστημα έχει τραπέζια.
  const hasTables = (await db.diningTable.count({ where: { orgId: ctx.org.id, storeId: ctx.store.id, active: true } })) > 0;
  // Ό,τι χρειάζεται η εφαρμογή για να βγάλει απόδειξη χωρίς σύνδεση (lib/pos-offline.ts). Όχι με τερματικό Cloud: θέλει internet.
  const offline = ctx.device.vivaCloud ? null : { merchantVat: ctx.issuer.vatNumber, series: ctx.device.series, nextAa: ctx.device.nextAa };
  return Response.json({ device: { name: ctx.device.name, series: ctx.device.series }, store: ctx.store.name, hasTables, categories: flat, frequent, paymentMethods, offline, soldOut: await soldOutIds(ctx) });
}
