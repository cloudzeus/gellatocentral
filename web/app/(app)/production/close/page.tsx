import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft, CheckCheck } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { athensDayRange } from "@/lib/production-day-close";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { closeDay } from "../workflow-actions";

const athensToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Athens" }).format(new Date());
const dateFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });

export default async function ProductionDayClosePage({ searchParams }: PageProps<"/production/close">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const allowed = new Set(warehouses.map((warehouse) => warehouse.id));
  const businessDate = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : athensToday();
  const sourceWarehouseId = typeof q.source === "string" && allowed.has(q.source) ? q.source : warehouses[0]?.id ?? "";
  const destinationWarehouseId = typeof q.destination === "string" && allowed.has(q.destination) ? q.destination : warehouses[0]?.id ?? "";
  const range = athensDayRange(businessDate);
  const planWhere = {
    orgId: ctx.orgId, sourceWarehouseId, destinationWarehouseId,
    plannedFor: { gte: range.start, lt: range.end }, status: { in: ["PLANNED" as const, "IN_PROGRESS" as const] }, batchId: null,
  };
  const [plans, closes, closesTotal] = await Promise.all([
    sourceWarehouseId && destinationWarehouseId ? db.productionPlan.findMany({ where: planWhere, orderBy: [{ plannedFor: "asc" }, { id: "asc" }] }) : Promise.resolve([]),
    db.productionDayClose.findMany({ where: { orgId: ctx.orgId, warehouseId: { in: [...allowed] } }, orderBy: { businessDate: "desc" }, take: 10 }),
    db.productionDayClose.count({ where: { orgId: ctx.orgId, warehouseId: { in: [...allowed] } } }),
  ]);
  const recipes = await db.recipe.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(plans.map((plan) => plan.recipeId))] } }, select: { id: true, name: true } });
  const recipeNames = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const clientKey = randomUUID();

  return <Page section="Παραγωγή" title="Κλείσιμο ημέρας" description="Μία ατομική ενέργεια για όλα τα ανοιχτά plans, με αυτόματα ημιέτοιμα και FEFO χωρίς διπλή κατανάλωση" actions={<Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες</Link>}>
    <div className="grid max-w-6xl gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{q.error}</p> : null}
      {typeof q.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{q.saved}</p> : null}
      <Card className="p-4"><form className="grid items-end gap-3 md:grid-cols-4">
        <Field label="Επιχειρησιακή ημέρα" name="date" type="date" defaultValue={businessDate} required />
        <Select label="Αποθήκη υλικών" name="source" defaultValue={sourceWarehouseId} options={warehouses.map((row): [string, string] => [row.id, row.name])} required />
        <Select label="Αποθήκη τελικών" name="destination" defaultValue={destinationWarehouseId} options={warehouses.map((row): [string, string] => [row.id, row.name])} required />
        <button className={btn("outline")} type="submit">Προβολή ανοιχτών παραγωγών</button>
      </form></Card>

      {ctx.can("production.add") && plans.length ? <Card className="p-4">
        <div className="mb-4"><h2 className="font-semibold">Πραγματική απόδοση · {dateFmt.format(range.date)}</h2><p className="text-sm text-muted-foreground">Τα ημιέτοιμα που λείπουν θα παραχθούν αυτόματα στην αποθήκη υλικών. Αν αποτύχει οποιαδήποτε παρτίδα, δεν αποθηκεύεται καμία αλλαγή.</p></div>
        <form action={closeDay} className="grid gap-4">
          <input type="hidden" name="businessDate" value={businessDate} /><input type="hidden" name="sourceWarehouseId" value={sourceWarehouseId} /><input type="hidden" name="destinationWarehouseId" value={destinationWarehouseId} /><input type="hidden" name="clientKey" value={clientKey} />
          {plans.map((plan) => <fieldset key={plan.id} className="grid items-end gap-3 rounded-lg border border-border p-3 md:grid-cols-5">
            <input type="hidden" name="planId" value={plan.id} />
            <div><legend className="font-medium">{recipeNames.get(plan.recipeId) ?? "Συνταγή"}</legend><p className="text-sm text-muted-foreground">Αναμενόμενα {plan.quantityGrams.toLocaleString("el-GR")} g · {new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }).format(plan.plannedFor)}</p></div>
            <Field label="Πραγματικά g" name={`actual:${plan.id}`} type="number" min={1} max={plan.quantityGrams} step={1} defaultValue={plan.quantityGrams} required />
            <Field label="Αιτιολογία φύρας" name={`scrap:${plan.id}`} maxLength={300} />
            <Field label="Λεπτά εργασίας" name={`minutes:${plan.id}`} type="number" min={0} step={1} defaultValue={0} />
            <Field label="Εργατικά €" name={`labour:${plan.id}`} inputMode="decimal" defaultValue="0" />
          </fieldset>)}
          <div><Submit className={btn("success")}><CheckCheck /> Κλείσιμο {plans.length} {plans.length === 1 ? "παραγωγής" : "παραγωγών"}</Submit></div>
        </form>
      </Card> : <Card className="p-5 text-sm text-muted-foreground">Δεν υπάρχουν ανοιχτές παραγωγές για την επιλεγμένη ημέρα και το ζεύγος αποθηκών.</Card>}

      <Card className="p-4"><h2 className="mb-3 font-semibold">Πρόσφατα κλεισίματα</h2>{closes.length ? <ul className="divide-y divide-border">{closes.map((close) => {
        const snapshot = close.snapshot as { results?: { batchId: string; batchNumber: string; automatic: boolean }[] };
        return <li key={close.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><div className="min-w-0 flex-1"><p className="font-medium">{dateFmt.format(close.businessDate)} · {warehouseNames.get(close.warehouseId) ?? "Αποθήκη"}</p><p className="text-muted-foreground">{snapshot.results?.length ?? 0} παρτίδες · {snapshot.results?.filter((row) => row.automatic).length ?? 0} αυτόματα ημιέτοιμα · {close.createdByName}</p></div><Badge tone={close.status === "COMPLETED" ? "success" : "warning"}>{close.status === "COMPLETED" ? "Ολοκληρωμένο" : close.status}</Badge><span className="flex flex-wrap gap-2">{snapshot.results?.map((row) => <Link key={row.batchId} href={`/production/${row.batchId}`} className="text-xs font-medium text-primary hover:underline">{row.batchNumber}</Link>)}</span></li>;
      })}</ul> : <p className="text-sm text-muted-foreground">Κανένα ημερήσιο κλείσιμο ακόμη.</p>}{closesTotal > closes.length ? <p className="mt-2 text-xs text-muted-foreground">Εμφανίζονται οι {closes.length} πιο πρόσφατες από {closesTotal}</p> : null}</Card>
    </div>
  </Page>;
}
