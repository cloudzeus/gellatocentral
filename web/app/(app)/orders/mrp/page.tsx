import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { buildMrpSuggestions } from "@/lib/procurement-db";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { saveMrp } from "../actions";

const qty = (value: number, dimension: string) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 3 }).format(value / stockCostScale(dimension));
export default async function MrpPage({ searchParams }: PageProps<"/orders/mrp">) {
  const query = await searchParams;
  const ctx = await requireStockContext("orders.read");
  const warehouses = await db.warehouse.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" } });
  const warehouseId = typeof query.warehouse === "string" && warehouses.some((w) => w.id === query.warehouse) ? query.warehouse : warehouses[0]?.id;
  const [suppliers, suggestions] = await Promise.all([db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "supplier" }, active: true } }), warehouseId ? buildMrpSuggestions(ctx, warehouseId) : []]);
  return <Page section="Αποθήκη & αγορές" title="Προτάσεις MRP" description="Κάλυψη από πραγματική κατανάλωση παραγωγής, απόθεμα και ανοιχτές παραγγελίες" actions={<Link href="/orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>}><div className="grid gap-4">{typeof query.error === "string" ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}<Card className="p-4"><form className="flex items-end gap-3"><Select label="Αποθήκη" name="warehouse" options={warehouses.map((w): [string, string] => [w.id, w.name])} defaultValue={warehouseId} /><Submit className={btn("default")}>Υπολογισμός</Submit></form></Card><div className="grid gap-3">{suggestions.map((row) => <Card key={row.generic.id} className="p-4"><div className="grid gap-4 lg:grid-cols-[1fr_2fr]"><div><h2 className="font-semibold">{row.generic.name}</h2><p className="text-sm text-muted-foreground">Απόθεμα {qty(row.onHandBaseQty, row.generic.baseUnit.dimension)} · ανοιχτές {qty(row.incomingBaseQty, row.generic.baseUnit.dimension)} · πρόταση <strong>{qty(row.suggestedBaseQty, row.generic.baseUnit.dimension)}</strong></p></div>{ctx.can("orders.edit") ? <form action={saveMrp} className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6"><input type="hidden" name="genericItemId" value={row.generic.id} /><input type="hidden" name="warehouseId" value={warehouseId} /><Select label="Προμηθευτής" name="supplierId" options={[["", "—"], ...suppliers.map((s): [string, string] => [s.id, s.name])]} defaultValue={row.setting?.supplierId ?? ""} /><Field label="Lead ημέρες" name="leadDays" type="number" min={0} defaultValue={row.setting?.leadDays ?? 1} required /><Field label="Κάλυψη" name="coverDays" type="number" min={0} defaultValue={row.setting?.coverDays ?? 4} required /><Field label="Ελάχιστο (βάση)" name="minimumBaseQty" type="number" min={0} defaultValue={row.setting?.minimumBaseQty ?? 0} required /><Field label="Πολλαπλάσιο" name="orderMultipleBase" type="number" min={1} defaultValue={row.setting?.orderMultipleBase ?? 1} required /><Submit className={btn("outline", "sm")} pendingText="Αποθήκευση…">Αποθήκευση</Submit></form> : null}</div></Card>)}{warehouseId && !suggestions.length ? <Card className="p-8 text-center text-sm text-muted-foreground">Δεν προκύπτει έλλειμμα με τους τρέχοντες κανόνες.</Card> : null}</div></div></Page>;
}
