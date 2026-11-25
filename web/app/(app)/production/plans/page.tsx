import Link from "next/link";
import { ArrowLeft, Check, Play, Plus, X } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { warehouseScopeWhere } from "@/lib/stock-scope";
import { changePlanStatus, completePlan, createPlan } from "../workflow-actions";

const STATUS = { PLANNED: "Προγραμματισμένη", IN_PROGRESS: "Σε εξέλιξη", COMPLETED: "Ολοκληρωμένη", CANCELLED: "Ακυρωμένη" } as const;
export default async function ProductionPlansPage({ searchParams }: PageProps<"/production/plans">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const allowedWarehouseIds = warehouses.map((row) => row.id);
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const machineWhere = {
    orgId: ctx.orgId,
    active: true,
    ...(restricted ? { OR: [{ warehouseId: null }, { warehouseId: { in: allowedWarehouseIds } }] } : {}),
  };
  const [plans, recipes, machines, employees, stores] = await Promise.all([
    db.productionPlan.findMany({ where: { orgId: ctx.orgId, sourceWarehouseId: { in: allowedWarehouseIds }, destinationWarehouseId: { in: allowedWarehouseIds } }, orderBy: { plannedFor: "desc" }, take: 100 }),
    db.recipe.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true, batchGrams: true }, orderBy: { name: "asc" } }),
    db.machine.findMany({ where: machineWhere, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const recipeIds = [...new Set(plans.map((plan) => plan.recipeId))];
  const warehouseIds = [...new Set(plans.flatMap((plan) => [plan.sourceWarehouseId, plan.destinationWarehouseId]))];
  const [planRecipes, planWarehouses] = await Promise.all([
    db.recipe.findMany({ where: { orgId: ctx.orgId, id: { in: recipeIds } }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: { orgId: ctx.orgId, id: { in: warehouseIds } }, select: { id: true, name: true } }),
  ]);
  const recipeNames = new Map(planRecipes.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(planWarehouses.map((row) => [row.id, row.name]));
  return <Page section="Παραγωγή" title="Προγραμματισμός παραγωγής" description="Μηχανήματα, χειριστές, αναμενόμενη απόδοση και ολοκλήρωση με κοινό FEFO writer" actions={<Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες</Link>}>
    <div className="grid gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{q.error}</p> : null}
      {typeof q.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{q.saved}</p> : null}
      {ctx.can("production.add") ? <Card className="p-4"><h2 className="mb-3 font-semibold">Νέα παραγωγή</h2><form action={createPlan} className="grid gap-3 md:grid-cols-3">
        <Select label="Συνταγή" name="recipeId" required options={recipes.map((row): [string, string] => [row.id, `${row.name} · ${row.batchGrams} g`])} />
        <Select label="Κατάστημα" name="storeId" options={[["", "Χωρίς σύνδεση"], ...stores.map((row): [string, string] => [row.id, row.name])]} />
        <Field label="Ημερομηνία" name="plannedFor" type="datetime-local" required />
        <Select label="Αποθήκη υλικών" name="sourceWarehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} />
        <Select label="Αποθήκη output" name="destinationWarehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} />
        <Field label="Ποσότητα (g)" name="quantityGrams" type="number" min={1} step={1} required />
        <Select label="Μηχάνημα" name="machineId" options={[["", "Χωρίς"], ...machines.map((row): [string, string] => [row.id, row.name])]} />
        <Select label="Χειριστής" name="operatorEmployeeId" options={[["", "Χωρίς"], ...employees.map((row): [string, string] => [row.id, row.name])]} />
        <Field label="Σημείωση" name="note" maxLength={500} />
        <div className="md:col-span-3"><Submit className={btn("default")}><Plus /> Προσθήκη στο πρόγραμμα</Submit></div>
      </form></Card> : null}
      <div className="grid gap-3">{plans.map((plan) => <Card key={plan.id} className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{recipeNames.get(plan.recipeId) ?? "Συνταγή"} · {(plan.quantityGrams / 1000).toLocaleString("el-GR")} kg</h2><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(plan.plannedFor)} · {warehouseNames.get(plan.sourceWarehouseId)} → {warehouseNames.get(plan.destinationWarehouseId)}</p></div><Badge tone={plan.status === "COMPLETED" ? "success" : plan.status === "CANCELLED" ? "danger" : "warning"}>{STATUS[plan.status]}</Badge></div>
        {plan.batchId ? <Link href={`/production/${plan.batchId}`} className="text-sm underline">Άνοιγμα παρτίδας και ιχνηλασιμότητας</Link> : null}
        {ctx.can("production.add") && ["PLANNED", "IN_PROGRESS"].includes(plan.status) ? <div className="grid gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-2"><form action={changePlanStatus}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="status" value={plan.status === "PLANNED" ? "IN_PROGRESS" : "CANCELLED"} /><Submit className={btn(plan.status === "PLANNED" ? "outline" : "destructive", "sm")}>{plan.status === "PLANNED" ? <><Play /> Έναρξη</> : <><X /> Ακύρωση</>}</Submit></form>{plan.status === "PLANNED" ? <form action={changePlanStatus}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="status" value="CANCELLED" /><Submit className={btn("destructive", "sm")}><X /> Ακύρωση</Submit></form> : null}</div>
          <form action={completePlan} className="grid items-end gap-2 md:grid-cols-6"><input type="hidden" name="planId" value={plan.id} /><Field label="Πραγματικά g" name="quantityGrams" type="number" min={1} max={plan.quantityGrams} defaultValue={plan.quantityGrams} required /><Field label="Αιτιολογία φύρας" name="scrapReason" maxLength={300} /><Field label="Λεπτά" name="labourMinutes" type="number" min={0} defaultValue={0} /><Field label="Εργατικά €" name="labourCost" inputMode="decimal" defaultValue="0" /><Field label="Παρτίδα" name="batchNumber" maxLength={80} /><Submit className={btn("success")}><Check /> Ολοκλήρωση</Submit></form>
        </div> : null}
      </Card>)}</div>
    </div>
  </Page>;
}
