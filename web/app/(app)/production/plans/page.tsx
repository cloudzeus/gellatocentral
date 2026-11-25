import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, Play, Plus, Timer, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Kpi, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions, statusValues } from "@/lib/status";
import { requireStockContext } from "@/lib/stock-context";
import { warehouseScopeWhere } from "@/lib/stock-scope";
import { changePlanStatus, completePlan, createPlan } from "../workflow-actions";

const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" });
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
  const list = listParams(q, 25, ["date", "quantity"]);
  const status = filterParam(q, "status", statusValues("productionPlan"));
  // αναζήτηση: όνομα συνταγής (το πλάνο κρατά μόνο recipeId, χωρίς σχέση) ή σημείωση
  // shortcut: ως 200 συνταγές ανά αναζήτηση, όπως το partyIdsByName· αν δεν φτάνει, να γίνει σχέση στο schema
  const matchingRecipes = list.q ? await db.recipe.findMany({ where: { orgId: ctx.orgId, name: { contains: list.q, mode: "insensitive" } }, select: { id: true }, take: 200 }) : [];
  const where = {
    orgId: ctx.orgId, sourceWarehouseId: { in: allowedWarehouseIds }, destinationWarehouseId: { in: allowedWarehouseIds },
    ...(status ? { status } : {}),
    ...(list.q ? { OR: [{ recipeId: { in: matchingRecipes.map((row) => row.id) } }, { note: { contains: list.q, mode: "insensitive" as const } }] } : {}),
  };
  const orderBy = list.sort === "quantity" ? [{ quantityGrams: list.dir }, { id: "desc" as const }] : [{ plannedFor: list.sort === "date" ? list.dir : ("desc" as const) }, { id: "desc" as const }];
  const scope = { orgId: ctx.orgId, sourceWarehouseId: { in: allowedWarehouseIds }, destinationWarehouseId: { in: allowedWarehouseIds } };
  const [plans, total, recipes, machines, employees, stores, plannedCount, runningCount, lateCount] = await Promise.all([
    db.productionPlan.findMany({ where, orderBy, skip: list.skip, take: list.take }),
    db.productionPlan.count({ where }),
    db.recipe.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true, batchGrams: true }, orderBy: { name: "asc" } }),
    db.machine.findMany({ where: machineWhere, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.productionPlan.count({ where: { ...scope, status: "PLANNED" } }),
    db.productionPlan.count({ where: { ...scope, status: "IN_PROGRESS" } }),
    db.productionPlan.count({ where: { ...scope, status: { in: ["PLANNED", "IN_PROGRESS"] }, plannedFor: { lt: new Date() } } }),
  ]);
  const recipeIds = [...new Set(plans.map((plan) => plan.recipeId))];
  const warehouseIds = [...new Set(plans.flatMap((plan) => [plan.sourceWarehouseId, plan.destinationWarehouseId]))];
  const [planRecipes, planWarehouses] = await Promise.all([
    db.recipe.findMany({ where: { orgId: ctx.orgId, id: { in: recipeIds } }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: { orgId: ctx.orgId, id: { in: warehouseIds } }, select: { id: true, name: true } }),
  ]);
  const now = new Date();
  const recipeNames = new Map(planRecipes.map((row) => [row.id, row.name]));
  const warehouseNames = new Map(planWarehouses.map((row) => [row.id, row.name]));
  const create = ctx.can("production.add") ? <Modal wide variant="default" size="sm" label={<><Plus /> Νέα παραγωγή</>} title="Νέα παραγωγή" description="Μπαίνει στο πρόγραμμα· τα υλικά αφαιρούνται μόνο όταν ολοκληρωθεί"><form action={createPlan} className="grid gap-3 md:grid-cols-3">
        <Select label="Συνταγή" name="recipeId" required options={recipes.map((row): [string, string] => [row.id, `${row.name} · ${row.batchGrams} g`])} />
        <Field label="Ποσότητα (g)" name="quantityGrams" type="number" min={1} step={1} required />
        <Field label="Πότε" name="plannedFor" type="datetime-local" required />
        <Select label="Αποθήκη υλικών" name="sourceWarehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} />
        <Select label="Αποθήκη τελικών" name="destinationWarehouseId" required options={warehouses.map((row): [string, string] => [row.id, row.name])} />
        <Select label="Για κατάστημα" name="storeId" options={[["", "Κανένα συγκεκριμένο"], ...stores.map((row): [string, string] => [row.id, row.name])]} />
        <Select label="Μηχάνημα" name="machineId" options={[["", "Χωρίς"], ...machines.map((row): [string, string] => [row.id, row.name])]} />
        <Select label="Χειριστής" name="operatorEmployeeId" options={[["", "Χωρίς"], ...employees.map((row): [string, string] => [row.id, row.name])]} />
        <Field label="Σημείωση" name="note" maxLength={500} />
        <div className="flex justify-end md:col-span-3"><Submit className={btn("default")}>Προσθήκη στο πρόγραμμα</Submit></div>
      </form></Modal> : null;
  return <Page section="Παραγωγή" title="Προγραμματισμός παραγωγής" description="Τι θα φτιαχτεί, πότε, με ποιο μηχάνημα και ποιον χειριστή" actions={<span className="flex flex-wrap gap-2"><Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες</Link>{create}</span>}>
    <div className="grid gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{q.error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={CalendarClock} label="Προγραμματισμένες" value={plannedCount} hint={plannedCount ? "Περιμένουν να ξεκινήσουν" : "Δες την πρόβλεψη για το τι χρειάζεται"} />
        <Kpi icon={Play} label="Σε εξέλιξη" value={runningCount} tone={runningCount ? "success" : "neutral"} hint={runningCount ? "Κλείσ' τες με την πραγματική ποσότητα" : "Τίποτα στη μηχανή αυτή τη στιγμή"} />
        <Kpi icon={Timer} label="Καθυστερούν" value={lateCount} tone={lateCount ? "danger" : "success"} hint={lateCount ? "Η ώρα τους πέρασε: ξεκίνα, ολοκλήρωσε ή ακύρωσε" : "Όλα στην ώρα τους"} />
      </div>
      <Card>
        <DataTable
          id="production-plans"
          listing={{ ...list, total, placeholder: "Συνταγή ή σημείωση", filters: [{ key: "status", label: "Κατάσταση", value: status, options: statusOptions("productionPlan") }] }}
          empty={<><p>Εδώ είναι το πρόγραμμα παραγωγής: τι θα φτιαχτεί, πότε και από ποια αποθήκη. Δεν έχει μπει καμία παραγωγή ακόμα.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</>}
          columns={[
            { key: "recipe", label: "Συνταγή", required: true },
            { key: "status", label: "Κατάσταση" },
            { key: "date", label: "Ημερομηνία", sortable: true },
            { key: "quantity", label: "Ποσότητα (kg)", numeric: true, sortable: true },
            { key: "route", label: "Αποθήκες" },
            { key: "batch", label: "Παρτίδα" },
            ]}
          rows={plans.map((plan) => {
            const recipe = recipeNames.get(plan.recipeId) ?? "Συνταγή";
            return {
              id: plan.id,
              cells: {
                recipe: <span className="font-semibold">{recipe}</span>,
                date: ["PLANNED", "IN_PROGRESS"].includes(plan.status) && plan.plannedFor < now ? <span className="font-medium text-destructive">{dateTime.format(plan.plannedFor)} · καθυστερεί</span> : dateTime.format(plan.plannedFor),
                quantity: (plan.quantityGrams / 1000).toLocaleString("el-GR"),
                route: <>{warehouseNames.get(plan.sourceWarehouseId)} → {warehouseNames.get(plan.destinationWarehouseId)}</>,
                batch: plan.batchId ? <Link href={`/production/${plan.batchId}`} className="underline underline-offset-2">Άνοιγμα παρτίδας και ιχνηλασιμότητας</Link> : "—",
                status: <StatusBadge kind="productionPlan" value={plan.status} />,
              },
              // οι ενέργειες (έναρξη, ακύρωση, ολοκλήρωση) ανοίγουν κάτω από τη γραμμή, μόνο όσο η παραγωγή είναι ανοιχτή
              details: ctx.can("production.add") && ["PLANNED", "IN_PROGRESS"].includes(plan.status) ? {
                label: recipe,
                view: <div className="grid gap-3">
                  <div className="flex flex-wrap gap-2"><form action={changePlanStatus}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="status" value={plan.status === "PLANNED" ? "IN_PROGRESS" : "CANCELLED"} /><Submit className={btn(plan.status === "PLANNED" ? "outline" : "destructive", "sm")}>{plan.status === "PLANNED" ? <><Play /> Έναρξη</> : <><X /> Ακύρωση</>}</Submit></form>{plan.status === "PLANNED" ? <form action={changePlanStatus}><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="status" value="CANCELLED" /><Submit className={btn("destructive", "sm")}><X /> Ακύρωση</Submit></form> : null}</div>
                  <form action={completePlan} className="grid items-end gap-2 md:grid-cols-6"><input type="hidden" name="planId" value={plan.id} /><Field label="Πραγματικά g" name="quantityGrams" type="number" min={1} max={plan.quantityGrams} defaultValue={plan.quantityGrams} required /><Field label="Αιτιολογία φύρας" name="scrapReason" maxLength={300} /><Field label="Λεπτά" name="labourMinutes" type="number" min={0} defaultValue={0} /><Field label="Εργατικά €" name="labourCost" inputMode="decimal" defaultValue="0" /><Field label="Παρτίδα" name="batchNumber" maxLength={80} /><Submit className={btn("default")}><Check /> Ολοκλήρωση</Submit></form>
                </div>,
              } : undefined,
            };
          })}
        />
      </Card>
    </div>
  </Page>;
}
