import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import { deviceReceiving } from "@/lib/receiving";
import { stockBalances } from "@/lib/stock-db";
import { spotKey, spotsFor } from "@/lib/storage-spots";

const SOON_DAYS = 3;

/** Απόθεμα των αποθηκών του καταστήματος για τον αποθηκάριο: ποσότητα, ελάχιστο, θέση, ό,τι λήγει σύντομα. */
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { stock, warehouseIds, denied } = await deviceReceiving(ctx, "stock");
  if (denied) return Response.json({ error: "role", message: denied }, { status: 403 });
  const orgId = stock.orgId;
  const [balances, thresholds, warehouses] = await Promise.all([
    stockBalances(db, { orgId, warehouseIds }),
    db.stockThreshold.findMany({ where: { orgId, warehouseId: { in: warehouseIds } }, select: { warehouseId: true, genericItemId: true, minimumQty: true } }),
    db.warehouse.findMany({ where: { orgId, id: { in: warehouseIds } }, select: { id: true, name: true } }),
  ]);
  const rows = new Map<string, { genericItemId: string; warehouseId: string; qty: number; lots: { lotId: string; qty: number }[] }>();
  for (const b of balances) {
    const k = spotKey(b.genericItemId, b.warehouseId);
    const r = rows.get(k) ?? { genericItemId: b.genericItemId, warehouseId: b.warehouseId, qty: 0, lots: [] };
    r.qty += b.quantity;
    if (b.lotId && b.quantity > 0) r.lots.push({ lotId: b.lotId, qty: b.quantity });
    rows.set(k, r);
  }
  for (const t of thresholds) if (!rows.has(spotKey(t.genericItemId, t.warehouseId))) rows.set(spotKey(t.genericItemId, t.warehouseId), { genericItemId: t.genericItemId, warehouseId: t.warehouseId, qty: 0, lots: [] });
  const list = [...rows.values()].filter((r) => r.qty !== 0 || thresholds.some((t) => t.genericItemId === r.genericItemId && t.warehouseId === r.warehouseId));
  const ids = [...new Set(list.map((r) => r.genericItemId))];
  const soon = new Date(Date.now() + SOON_DAYS * 86_400_000);
  const [generics, lots, spots] = await Promise.all([
    db.genericItem.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, baseUnit: { select: { dimension: true } } } }),
    db.stockLot.findMany({ where: { orgId, id: { in: list.flatMap((r) => r.lots.map((l) => l.lotId)) }, expiresAt: { lte: soon } }, select: { id: true, expiresAt: true } }),
    spotsFor(orgId, warehouseIds, ids),
  ]);
  const g = new Map(generics.map((x) => [x.id, x]));
  const expiry = new Map(lots.map((l) => [l.id, l.expiresAt!]));
  const items = list.map((r) => {
    const min = thresholds.find((t) => t.genericItemId === r.genericItemId && t.warehouseId === r.warehouseId)?.minimumQty ?? null;
    return {
      genericItemId: r.genericItemId, warehouseId: r.warehouseId, name: g.get(r.genericItemId)?.name ?? "—", dimension: g.get(r.genericItemId)?.baseUnit.dimension ?? "count",
      qty: r.qty, min, low: min != null && r.qty < min, spot: spots.of.get(spotKey(r.genericItemId, r.warehouseId)) ?? null,
      expiring: r.lots.filter((l) => expiry.has(l.lotId)).map((l) => ({ qty: l.qty, expiresAt: expiry.get(l.lotId)! })).sort((a, b) => +a.expiresAt - +b.expiresAt),
    };
  }).sort((a, b) => Number(b.low) - Number(a.low) || b.expiring.length - a.expiring.length || a.name.localeCompare(b.name, "el"));
  return Response.json({ items, warehouses: warehouses.map((w) => ({ ...w, spots: spots.byWarehouse.get(w.id) ?? [] })) });
}
