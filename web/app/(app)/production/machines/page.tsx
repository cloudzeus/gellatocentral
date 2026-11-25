import Link from "next/link";
import { AlarmClock, ArrowLeft, Cog, Plus, Wrench } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Kpi, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { warehouseScopeWhere } from "@/lib/stock-scope";
import { addMaintenance, createMachine } from "../workflow-actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

export default async function MachinesPage({ searchParams }: PageProps<"/production/machines">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true } });
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const machineWhere = {
    orgId: ctx.orgId,
    ...(restricted ? { OR: [{ warehouseId: null }, { warehouseId: { in: warehouses.map((row) => row.id) } }] } : {}),
  };
  const [machines, maintenance, maintenanceTotal] = await Promise.all([
    db.machine.findMany({ where: machineWhere, orderBy: { name: "asc" } }),
    db.machineMaintenance.findMany({ where: { orgId: ctx.orgId, machine: machineWhere }, orderBy: { performedAt: "desc" }, take: 30 }),
    db.machineMaintenance.count({ where: { orgId: ctx.orgId, machine: machineWhere } }),
  ]);
  const names = new Map(warehouses.map((row) => [row.id, row.name]));
  const machineNames = new Map(machines.map((row) => [row.id, row.name]));
  const fmt = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" });
  const today = new Date();
  // shortcut: η επόμενη συντήρηση βγαίνει από τις 30 πιο πρόσφατες εγγραφές· αν μεγαλώσει το ιστορικό, ξεχωριστό query ανά μηχάνημα
  const nextDue = new Map<string, Date>();
  for (const row of maintenance) if (row.nextDueAt && !nextDue.has(row.machineId)) nextDue.set(row.machineId, row.nextDueAt);
  const overdue = machines.filter((m) => m.active && (nextDue.get(m.id)?.getTime() ?? Infinity) < today.getTime()).length;
  const canAdd = ctx.can("production.add");
  const create = canAdd ? <Modal variant="default" size="sm" label={<><Plus /> Μηχάνημα</>} title="Νέο μηχάνημα"><form action={createMachine} className="grid gap-3 sm:grid-cols-2"><Field label="Μηχάνημα" name="name" required maxLength={120} /><Field label="Κωδικός" name="code" maxLength={60} /><Select label="Αποθήκη" name="warehouseId" options={[...(!restricted ? [["", "Κοινό για όλες"] as [string, string]] : []), ...warehouses.map((row): [string, string] => [row.id, row.name])]} /><Field label="Δυναμικότητα ανά κύκλο (g)" name="capacityGrams" type="number" min={1} /><Submit className={btn("default", "default", "sm:col-span-2 justify-self-end")}>Προσθήκη</Submit></form></Modal> : null;
  return <Page section="Παραγωγή" title="Μηχανήματα & συντήρηση" description="Δυναμικότητα κάθε μηχανήματος και ιστορικό συντηρήσεων" actions={<span className="flex flex-wrap gap-2"><Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παραγωγή</Link>{create}</span>}>
    <div className="grid gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{q.error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={Cog} label="Ενεργά μηχανήματα" value={machines.filter((m) => m.active).length} hint={`${machines.length} συνολικά`} />
        <Kpi icon={AlarmClock} label="Συντήρηση σε καθυστέρηση" value={overdue} tone={overdue ? "danger" : "success"} hint={overdue ? "Κανόνισε τεχνικό πριν σταματήσει η παραγωγή" : "Όλα εντός προγράμματος"} />
        <Kpi icon={Wrench} label="Συντηρήσεις" value={maintenanceTotal} hint={`Κόστος τελευταίων: ${euro(maintenance.reduce((sum, row) => sum + row.costCents, 0))}`} />
      </div>
      {machines.length ? <div className="grid gap-3 md:grid-cols-2">{machines.map((machine) => {
        const due = nextDue.get(machine.id);
        const late = !!due && due.getTime() < today.getTime();
        return <Card key={machine.id} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">{machine.name}</h2><p className="text-muted-foreground">{machine.code ?? "Χωρίς κωδικό"} · {machine.warehouseId ? names.get(machine.warehouseId) ?? "Αποθήκη" : "Κοινό"}{machine.capacityGrams ? ` · ${(machine.capacityGrams / 1000).toLocaleString("el-GR")} kg ανά κύκλο` : ""}</p></div><StatusBadge look={look(machine.active ? "success" : "neutral", machine.active ? "Ενεργό" : "Ανενεργό")} /></div>
          <p className={late ? "flex items-center gap-1.5 font-medium text-destructive" : "flex items-center gap-1.5 text-muted-foreground"}><AlarmClock className="size-4" aria-hidden />{due ? `${late ? "Έπρεπε να συντηρηθεί στις" : "Επόμενη συντήρηση"} ${fmt.format(due)}` : "Χωρίς προγραμματισμένη συντήρηση"}</p>
          {canAdd && (!restricted || machine.warehouseId) ? <div><Modal size="sm" label={<><Wrench /> Καταγραφή συντήρησης</>} title={`Συντήρηση · ${machine.name}`}><form action={addMaintenance} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="machineId" value={machine.id} /><Field label="Εργασία" name="kind" required /><Field label="Έγινε στις" name="performedAt" type="date" required /><Field label="Επόμενη" name="nextDueAt" type="date" hint="Γίνεται κόκκινο όταν περάσει" /><Field label="Κόστος €" name="cost" inputMode="decimal" defaultValue="0" /><div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" /></div><Submit className={btn("default", "default", "sm:col-span-2 justify-self-end")}>Καταγραφή</Submit></form></Modal></div> : null}
        </Card>;
      })}</div> : <Card className="p-6 text-center text-muted-foreground"><p>Δεν έχεις καταχωρίσει μηχανήματα. Πρόσθεσέ τα για να βλέπεις δυναμικότητα και συντηρήσεις.</p>{create ? <div className="mt-3 flex justify-center">{create}</div> : null}</Card>}
      <Card className="p-4"><h2 className="mb-3 font-semibold">Πρόσφατες συντηρήσεις</h2>{maintenance.length ? <ul className="divide-y divide-border/60">{maintenance.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2"><span><strong className="font-medium">{machineNames.get(row.machineId)}</strong> · {row.kind}<span className="block text-muted-foreground">{fmt.format(row.performedAt)}{row.nextDueAt ? ` · επόμενη ${fmt.format(row.nextDueAt)}` : ""}</span></span><span className="tabular-nums">{euro(row.costCents)}</span></li>)}</ul> : <p className="text-muted-foreground">Καμία συντήρηση ακόμα.</p>}{maintenanceTotal > maintenance.length ? <p className="mt-2 text-muted-foreground">Φαίνονται οι {maintenance.length} πιο πρόσφατες από {maintenanceTotal}</p> : null}</Card>
    </div>
  </Page>;
}
