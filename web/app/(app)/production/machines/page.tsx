import Link from "next/link";
import { ArrowLeft, Plus, Wrench } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { warehouseScopeWhere } from "@/lib/stock-scope";
import { addMaintenance, createMachine } from "../workflow-actions";

export default async function MachinesPage({ searchParams }: PageProps<"/production/machines">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true } });
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const machineWhere = {
    orgId: ctx.orgId,
    ...(restricted ? { OR: [{ warehouseId: null }, { warehouseId: { in: warehouses.map((row) => row.id) } }] } : {}),
  };
  const [machines, maintenance] = await Promise.all([
    db.machine.findMany({ where: machineWhere, orderBy: { name: "asc" } }),
    db.machineMaintenance.findMany({ where: { orgId: ctx.orgId, machine: machineWhere }, orderBy: { performedAt: "desc" }, take: 30 }),
  ]);
  const names = new Map(warehouses.map((row) => [row.id, row.name]));
  const machineNames = new Map(machines.map((row) => [row.id, row.name]));
  return <Page section="Παραγωγή" title="Μηχανήματα & συντήρηση" description="Δυναμικότητα και ιστορικό τεχνικών εργασιών ανά tenant" actions={<Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παραγωγή</Link>}>
    <div className="grid gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{q.error}</p> : null}
      {typeof q.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{q.saved}</p> : null}
      {ctx.can("production.add") ? <Card className="p-4"><form action={createMachine} className="grid items-end gap-3 md:grid-cols-5"><Field label="Μηχάνημα" name="name" required maxLength={120} /><Field label="Κωδικός" name="code" maxLength={60} /><Select label="Αποθήκη" name="warehouseId" options={[...(!restricted ? [["", "Κοινό"] as [string, string]] : []), ...warehouses.map((row): [string, string] => [row.id, row.name])]} /><Field label="Δυναμικότητα (g)" name="capacityGrams" type="number" min={1} /><Submit className={btn("default")}><Plus /> Προσθήκη</Submit></form></Card> : null}
      <div className="grid gap-3 md:grid-cols-2">{machines.map((machine) => <Card key={machine.id} className="p-4"><div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">{machine.name}</h2><p className="text-sm text-muted-foreground">{machine.code ?? "—"} · {machine.warehouseId ? names.get(machine.warehouseId) ?? "Αποθήκη" : "Κοινό"}{machine.capacityGrams ? ` · ${(machine.capacityGrams / 1000).toLocaleString("el-GR")} kg` : ""}</p></div><Badge tone={machine.active ? "success" : "danger"}>{machine.active ? "Ενεργό" : "Ανενεργό"}</Badge></div>{ctx.can("production.add") && (!restricted || machine.warehouseId) ? <form action={addMaintenance} className="mt-3 grid items-end gap-2 sm:grid-cols-2"><input type="hidden" name="machineId" value={machine.id} /><Field label="Εργασία" name="kind" required /><Field label="Εκτελέστηκε" name="performedAt" type="date" required /><Field label="Επόμενη" name="nextDueAt" type="date" /><Field label="Κόστος €" name="cost" inputMode="decimal" defaultValue="0" /><Field label="Σημειώσεις" name="notes" /><Submit className={btn("outline", "sm")}><Wrench /> Καταγραφή</Submit></form> : null}</Card>)}</div>
      <Card className="p-4"><h2 className="mb-3 font-semibold">Πρόσφατη συντήρηση</h2><ul className="grid gap-2 text-sm">{maintenance.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 last:border-0"><span>{machineNames.get(row.machineId)} · {row.kind}<small className="block text-muted-foreground">{new Intl.DateTimeFormat("el-GR").format(row.performedAt)}{row.nextDueAt ? ` · επόμενη ${new Intl.DateTimeFormat("el-GR").format(row.nextDueAt)}` : ""}</small></span><span>{euro(row.costCents)}</span></li>)}</ul></Card>
    </div>
  </Page>;
}
