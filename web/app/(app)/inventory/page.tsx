import { Plus, Star, Warehouse as WarehouseIcon, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { Submit } from "@/components/submit";
import { db } from "@/lib/db";
import { currentOrg } from "@/lib/auth";
import { addWarehouse, attachStore, detachStore, makeDefault, toggleWarehouse } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const field = "h-8.5 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const { org, can } = await currentOrg("warehouses.read");
  const q = await searchParams;
  const [warehouses, stores] = await Promise.all([
    db.warehouse.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      include: {
        device: { select: { name: true } },
        stores: { include: { store: { select: { id: true, name: true, active: true } } }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }] },
        _count: { select: { movements: true } },
      },
    }),
    db.store.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" } }),
  ]);
  const activeStores = stores.filter((s) => s.active);
  const edit = can("warehouses.edit");

  return (
    <Page
      section="Αποθήκη & αγορές" title="Αποθήκες"
      description="Οι χώροι όπου τηρείται απόθεμα. Μία αποθήκη μπορεί να εξυπηρετεί πολλά καταστήματα (π.χ. κεντρική) — σε κάθε κατάστημα ορίζεις ποιες επιτρέπονται και ποια είναι η προεπιλογή του"
      actions={
        can("warehouses.add") ? (
          <Modal label={<><Plus /> Νέα αποθήκη</>} variant="default" title="Νέα αποθήκη" description="Δημιουργείται χωρίς σύνδεση· μετά τη δένεις στα καταστήματα που εξυπηρετεί">
            <form action={addWarehouse} className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
              <Field label="Όνομα" name="name" required minLength={2} maxLength={60} placeholder="π.χ. Κεντρική αποθήκη" />
              <Field label="Κωδικός" name="code" maxLength={20} placeholder="π.χ. CENTRAL" hint="Προαιρετικός · κεφαλαία λατινικά, αριθμοί, παύλες" />
              <Submit className={btn("default")}>Προσθήκη αποθήκης</Submit>
            </form>
          </Modal>
        ) : null
      }
    >
      <div className="max-w-5xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {String(q.error)}</p> : null}

        {warehouses.length === 0 ? (
          <Card className="px-5 py-10 text-center text-muted-foreground">
            <WarehouseIcon className="mx-auto mb-3 size-8" />
            Καμία αποθήκη ακόμα. Πρόσθεσε την πρώτη — μπορεί να εξυπηρετεί ένα ή περισσότερα καταστήματα.
          </Card>
        ) : (
          warehouses.map((w) => {
            const linked = new Set(w.stores.map((l) => l.storeId));
            const unlinked = activeStores.filter((s) => !linked.has(s.id));
            return (
              <Card key={w.id}>
                <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg">{w.name}{w.code ? <span className="ml-2 font-mono text-sm text-muted-foreground">{w.code}</span> : null}</h2>
                    <p className="text-xs text-muted-foreground">
                      {[
                        w.device && `είναι η συσκευή «${w.device.name}»`,
                        w._count.movements ? `${w._count.movements} κινήσεις αποθέματος` : "χωρίς κινήσεις ακόμα",
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <StatusBadge look={look(w.active ? "success" : "neutral", w.active ? "Ενεργή" : "Ανενεργή")} />
                  {edit ? <form action={toggleWarehouse.bind(null, w.id)}><Submit className={btn("outline", "sm")}>{w.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : null}
                </div>

                <ul className="divide-y divide-border/70">
                  {w.stores.length === 0 ? <li className="px-5 py-4 text-sm text-muted-foreground">Δεν εξυπηρετεί ακόμα κάποιο κατάστημα</li> : null}
                  {w.stores.map((l) => (
                    <li key={l.storeId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="min-w-0 flex-1 font-medium">
                        {l.store.name}
                        {!l.store.active ? <span className="ml-2 text-xs text-muted-foreground">(ανενεργό)</span> : null}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">προτεραιότητα {l.priority}</span>
                      </span>
                      {l.isDefault ? <Badge tone="success"><Star className="size-3" /> Προεπιλογή</Badge> : null}
                      {edit && !l.isDefault && l.store.active ? (
                        <form action={makeDefault.bind(null, w.id, l.storeId)}><Submit className={btn("outline", "sm")}>Ορισμός προεπιλογής</Submit></form>
                      ) : null}
                      {edit && !l.store.active ? null : edit ? (
                        <form action={detachStore.bind(null, w.id, l.storeId)}><Submit className={btn("ghost", "sm")}><X /> Αποσύνδεση</Submit></form>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {edit && w.active && unlinked.length ? (
                  <form action={attachStore} className="flex flex-wrap items-end gap-3 border-t border-border/70 bg-secondary/40 px-5 py-4">
                    <input type="hidden" name="warehouseId" value={w.id} />
                    <div className="min-w-44 flex-1"><Select label="Σύνδεση με κατάστημα" name="storeId" className={field} options={unlinked.map((s): [string, string] => [s.id, s.name])} /></div>
                    <label className="w-28 space-y-1 text-sm font-medium">Προτεραιότητα
                      <input name="priority" type="number" min={0} max={999} defaultValue={100} className={field} />
                    </label>
                    <label className="flex h-8.5 items-center gap-2 text-sm font-medium pointer-coarse:h-11">
                      <Checkbox name="isDefault" /> Προεπιλογή
                    </label>
                    <Submit className={btn("default", "sm")}>Σύνδεση</Submit>
                  </form>
                ) : null}
              </Card>
            );
          })
        )}
      </div>
    </Page>
  );
}
