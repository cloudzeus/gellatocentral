import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowRightLeft, Boxes, Warehouse } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Page } from "@/components/ui";
import { Submit } from "@/components/submit";
import { db } from "@/lib/db";
import { listParams } from "@/lib/paging";
import { look } from "@/lib/status";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { stockBalances } from "@/lib/stock-db";
import { formatStockQuantity, formatStockValue, stockDisplayUnit, stockUnitCostHundredths } from "@/lib/stock-view";
import { postTransfer } from "./actions";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// STK-04: Server Component και native POST form· η μόνη διαδραστική φόρμα χρησιμοποιεί το υπάρχον Submit.
export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const ctx = await requireStockContext("stock.read");
  const warehouses = await db.warehouse.findMany({
    where: warehouseScopeWhere(ctx),
    select: { id: true, name: true, active: true },
    orderBy: { name: "asc" },
  });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const list = listParams(q, 25, ["date"]);
  const contains = { contains: list.q, mode: "insensitive" as const };
  // αναζήτηση: είδος, αριθμός παρτίδας, αποθήκη, σημείωση ή χρήστης· το scope αποθηκών μένει ξεχωριστό AND
  const where = {
    orgId: ctx.orgId,
    AND: [
      { OR: [{ sourceWarehouseId: { in: warehouseIds } }, { destinationWarehouseId: { in: warehouseIds } }] },
      list.q ? { OR: [{ lines: { some: { OR: [{ genericItem: { name: contains } }, { sourceLot: { batchNumber: contains } }] } } }, { sourceWarehouse: { name: contains } }, { destinationWarehouse: { name: contains } }, { note: contains }, { createdByName: contains }] } : {},
    ],
  };
  const [stores, balances, transfers, total] = await Promise.all([
    db.store.findMany({
      where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    stockBalances(db, { orgId: ctx.orgId, warehouseIds }),
    db.stockTransfer.findMany({
      where,
      include: {
        sourceWarehouse: { select: { name: true } },
        destinationWarehouse: { select: { name: true } },
        store: { select: { name: true } },
        lines: {
          include: {
            genericItem: { include: { baseUnit: true } },
            sourceLot: { select: { batchNumber: true } },
            destinationLot: { select: { batchNumber: true } },
          },
          orderBy: [{ genericItemId: "asc" }, { sourceLotId: "asc" }],
        },
      },
      orderBy: [{ createdAt: list.sort === "date" ? list.dir : "desc" }, { id: "desc" }],
      skip: list.skip, take: list.take,
    }),
    db.stockTransfer.count({ where }),
  ]);

  const positive = balances.filter((balance) => balance.quantity > 0);
  const genericIds = [...new Set(positive.map((balance) => balance.genericItemId))];
  const lotIds = positive.flatMap((balance) => balance.lotId ? [balance.lotId] : []);
  const [generics, lots] = await Promise.all([
    genericIds.length ? db.genericItem.findMany({
      where: { orgId: ctx.orgId, id: { in: genericIds } },
      include: { baseUnit: true },
    }) : Promise.resolve([]),
    lotIds.length ? db.stockLot.findMany({ where: { orgId: ctx.orgId, id: { in: lotIds } } }) : Promise.resolve([]),
  ]);
  const genericById = new Map(generics.map((generic) => [generic.id, generic]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const options = positive.flatMap((balance) => {
    const generic = genericById.get(balance.genericItemId);
    const warehouse = warehouseById.get(balance.warehouseId);
    const lot = balance.lotId ? lotById.get(balance.lotId) : null;
    return generic && warehouse ? [{
      value: `${generic.id}|${lot?.id ?? ""}`,
      label: `${generic.name} · ${lot ? `παρτίδα ${lot.batchNumber ?? "χωρίς αριθμό"}` : "χωρίς παρτίδα"} · ${warehouse.name} · ${formatStockQuantity(balance.quantity, generic.baseUnit.dimension)}`,
    }] : [];
  }).sort((a, b) => a.label.localeCompare(b.label, "el"));
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
  const canTransfer = ctx.can("stock.transfer");
  const error = param(q.error);

  return (
    <Page
      section="Αποθήκη & αγορές"
      title="Μεταφορές αποθέματος"
      description="Άμεση μεταφορά πρώτων υλών μεταξύ αποθηκών, με διατήρηση παρτίδας, λήξης και κόστους"
      actions={<Link href="/inventory/stock" className={btn("outline", "sm")}><Boxes /> Απόθεμα</Link>}
    >
      <div className="grid max-w-[90rem] gap-5">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν καταχωρίστηκε μεταφορά: {error}</p> : null}

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><ArrowRightLeft className="size-5" /> Νέα μεταφορά</h2>
            <p className="mt-1 text-sm text-muted-foreground">Η ποσότητα αφαιρείται από την προέλευση και προστίθεται στον προορισμό στην ίδια ατομική εγγραφή.</p>
          </div>
          {!canTransfer ? <p className="px-5 py-5 text-sm text-muted-foreground">Έχεις δικαίωμα προβολής, αλλά όχι εκτέλεσης μεταφοράς.</p> : null}
          {canTransfer && activeWarehouses.length < 2 ? <p className="px-5 py-5 text-sm text-muted-foreground">Χρειάζονται δύο ενεργές, επιτρεπτές αποθήκες. {ctx.can("warehouses.read") ? <Link href="/inventory" className="underline underline-offset-2">Διαχείριση αποθηκών</Link> : null}</p> : null}
          {canTransfer && activeWarehouses.length >= 2 && !options.length ? <p className="px-5 py-5 text-sm text-muted-foreground">Δεν υπάρχει θετικό απόθεμα προς μεταφορά στις επιτρεπτές αποθήκες.</p> : null}
          {canTransfer && activeWarehouses.length >= 2 && options.length ? (
            <form action={postTransfer} className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <input type="hidden" name="clientKey" value={randomUUID()} />
              <label className="space-y-1 text-sm font-medium">Αποθήκη προέλευσης
                <select name="sourceWarehouseId" required className={field} defaultValue={activeWarehouses[0]!.id}>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium">Αποθήκη προορισμού
                <select name="destinationWarehouseId" required className={field} defaultValue={activeWarehouses[1]!.id}>
                  {activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">Είδος και παρτίδα
                <select name="stockKey" required className={field} defaultValue="">
                  <option value="" disabled>Επίλεξε διαθέσιμο απόθεμα</option>
                  {options.map((option, index) => <option key={`${option.value}-${index}`} value={option.value}>{option.label}</option>)}
                </select>
                <span className="block text-xs font-normal text-muted-foreground">Η ετικέτα δείχνει και την αποθήκη προέλευσης· επίλεξε την ίδια και παραπάνω.</span>
              </label>
              <label className="space-y-1 text-sm font-medium">Ποσότητα στη βασική μονάδα
                <input name="quantity" type="number" inputMode="numeric" min={1} max={2_147_483_647} step={1} required placeholder="π.χ. 5000" className={field} />
                <span className="block text-xs font-normal text-muted-foreground">mg, ml ή τεμάχια, όπως εμφανίζεται στο είδος· μόνο ακέραιος.</span>
              </label>
              <label className="space-y-1 text-sm font-medium">Κατάστημα (προαιρετικό)
                <select name="storeId" className={field} defaultValue="">
                  <option value="">Χωρίς πλαίσιο καταστήματος</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium md:col-span-2">Σημείωση (προαιρετική)
                <textarea name="note" maxLength={500} rows={2} placeholder="π.χ. Ανατροφοδότητα καταστήματος" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
              </label>
              <div className="md:col-span-2 md:justify-self-end"><Submit className={btn("default")} pendingText="Καταχώριση μεταφοράς…">Εκτέλεση μεταφοράς</Submit></div>
            </form>
          ) : null}
        </Card>

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Ιστορικό μεταφορών</h2>
          <Card>
            <DataTable
              id="stock-transfers"
              listing={{ ...list, total, placeholder: "Είδος, παρτίδα, αποθήκη, σημείωση ή χρήστης" }}
              empty="Εδώ φαίνεται κάθε μεταφορά αποθέματος από μια αποθήκη σε άλλη. Δεν έχει γίνει καμία ακόμα στις αποθήκες στις οποίες έχεις πρόσβαση."
              columns={[
                { key: "date", label: "Ημερομηνία", required: true, sortable: true },
                { key: "status", label: "Κατάσταση" },
                { key: "route", label: "Διαδρομή", wrap: true },
                { key: "items", label: "Είδη και παρτίδες", wrap: true },
                { key: "createdBy", label: "Καταχώριση" },
                ]}
              rows={transfers.map((transfer) => ({
                id: transfer.id,
                cells: {
                  date: dateTime.format(transfer.createdAt),
                  route: <>
                    <div className="flex flex-wrap items-center gap-2 font-medium"><Warehouse className="size-4 text-muted-foreground" />{transfer.sourceWarehouse.name}<ArrowRightLeft className="size-4 text-muted-foreground" />{transfer.destinationWarehouse.name}</div>
                    {transfer.store ? <p className="mt-1 text-xs text-muted-foreground">Κατάστημα: {transfer.store.name}</p> : null}
                    {transfer.note ? <p className="mt-1 text-xs text-muted-foreground">{transfer.note}</p> : null}
                  </>,
                  items: <ul className="space-y-2">
                    {transfer.lines.map((line) => (
                      <li key={line.id}>
                        <span className="font-medium">{line.genericItem.name}</span> · {formatStockQuantity(line.quantity, line.genericItem.baseUnit.dimension)}
                        <span className="block text-xs text-muted-foreground">{line.sourceLot ? `Παρτίδα ${line.sourceLot.batchNumber ?? "χωρίς αριθμό"} → ${line.destinationLot?.batchNumber ?? "χωρίς αριθμό"}` : "Χωρίς παρτίδα"}</span>
                        {line.unitCostHundredths > 0 ? <span className="block text-xs text-muted-foreground">Κόστος τη στιγμή της μεταφοράς: {formatStockValue(stockUnitCostHundredths(line.unitCostHundredths, stockDisplayUnit(line.genericItem.baseUnit).toBase, line.genericItem.baseUnit.dimension))} / {stockDisplayUnit(line.genericItem.baseUnit).code}</span> : null}
                      </li>
                    ))}
                  </ul>,
                  createdBy: transfer.createdByName,
                  status: <StatusBadge look={look("success", "Οριστική")} />,
                },
              }))}
            />
          </Card>
        </section>
      </div>
    </Page>
  );
}
