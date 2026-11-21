import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardEdit, Euro, FlaskConical, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { normalizeManufacturerName } from "@/lib/manufacturer";
import { listParams } from "@/lib/paging";
import { resolvePrice } from "@/lib/purchase-pricing";
import { formatBaseQty } from "@/lib/units";
import {
  activateSupplierItems,
  addCorrection,
  addMapping,
  addSupplierItemPrice,
  hideSupplierItems,
  removeMapping,
  removeMappings,
  saveSupplierItem,
  toggleSupplierItem,
} from "../actions";

// Καρτέλα γενικού είδους: ποιες συσκευασίες του κεντρικού καταλόγου το τροφοδοτούν (υιοθεσία με
// barcode) και ποιοι προμηθευτές τις πουλάνε, με τον δικό τους κωδικό και την πολλαπλότητα.
export default async function GenericItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("items.read");
  const { id } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["warehouse", "kind", "batch", "expiry", "quantity", "item", "brand", "ean", "content", "supplier", "code", "pack", "price", "status", "validFrom", "min", "note"]);
  const generic = await db.genericItem.findFirst({
    where: { id, orgId: org.id },
    include: {
      baseUnit: true,
      vatRate: true,
      composition: { select: { id: true } },
      mappings: { orderBy: { createdAt: "asc" }, include: { tradeItem: { include: { brand: { include: { manufacturer: true } }, contentUnit: true } } } },
    },
  });
  if (!generic) notFound();
  const tradeIds = generic.mappings.map((m) => m.tradeItemId);
  const [supplierItems, suppliers, units, stockByWarehouse, warehouses, lotSums, lots] = await Promise.all([
    tradeIds.length
      ? db.supplierItem.findMany({ where: { orgId: org.id, tradeItemId: { in: tradeIds } }, include: { supplier: true, tradeItem: true, prices: { orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] } }, orderBy: [{ supplier: { name: "asc" } }] })
      : Promise.resolve([]),
    db.party.findMany({ where: { orgId: org.id, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.unit.findMany({ where: { active: true } }),
    db.stockMovement.groupBy({ by: ["warehouseId"], where: { orgId: org.id, genericItemId: id }, _sum: { quantity: true } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
    db.stockMovement.groupBy({ by: ["lotId"], where: { orgId: org.id, genericItemId: id, lotId: { not: null } }, _sum: { quantity: true } }),
    db.stockLot.findMany({ where: { orgId: org.id, genericItemId: id }, include: { warehouse: true } }),
  ]);
  const dimUnits = units.filter((u) => u.dimension === generic.baseUnit.dimension);
  const fmt = (baseQty: number) => formatBaseQty(baseQty, dimUnits);
  const lotQty = new Map(lotSums.map((l) => [l.lotId, l._sum.quantity ?? 0]));
  const liveLots = lots.filter((l) => (lotQty.get(l.id) ?? 0) !== 0); // μόνο παρτίδες με υπόλοιπο
  const content = (t: (typeof generic.mappings)[number]["tradeItem"]) => formatBaseQty(t.contentQty, units.filter((u) => u.dimension === t.contentUnit.dimension));
  const now = new Date();
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" }); // οι ημερομηνίες ισχύος κρατιούνται σε UTC μεσάνυχτα

  // Η ταξινόμηση αποφασίζεται στον server από το URL· κάθε πίνακας της καρτέλας μοιράζεται την ίδια σύμβαση.
  const ordered = <T,>(rows: T[], keys: string[], value: (row: T, key: string) => string | number) => {
    const key = list.sort;
    if (!key || !keys.includes(key)) return rows;
    return [...rows].sort((a, b) => {
      const av = value(a, key), bv = value(b, key);
      const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
      return list.dir === "asc" ? result : -result;
    });
  };
  const paginated = <T,>(rows: T[]) => rows.slice(list.skip, list.skip + list.take);
  const listing = (total: number, placeholder: string) => ({ ...list, total, placeholder, showSearch: false });

  const mappingForm = (
    <form action={addMapping} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="genericItemId" value={generic.id} />
      <BarcodeField label="Barcode συσκευασίας" name="code" hint="EAN-13 της μονάδας ή GTIN-14/GS1 του κιβωτίου — αναζητείται στον κεντρικό κατάλογο" />
      <Submit className={btn("default")}>Σύνδεση</Submit>
    </form>
  );

  const supplierForm = (s?: (typeof supplierItems)[number]) => (
    <form key={s?.id ?? "new"} action={saveSupplierItem} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="supplierItemId" value={s?.id ?? ""} />
      <input type="hidden" name="genericItemId" value={generic.id} />
      <Select label="Προμηθευτής" name="supplierId" defaultValue={s?.supplierId} options={suppliers.map((p): [string, string] => [p.id, p.name])} />
      <Select label="Συσκευασία" name="tradeItemId" defaultValue={s?.tradeItemId} options={generic.mappings.map((m): [string, string] => [m.tradeItemId, `${m.tradeItem.name} (${content(m.tradeItem)})`])} />
      <Field label="Κωδικός προμηθευτή" name="supplierCode" maxLength={40} defaultValue={s?.supplierCode ?? ""} hint="Ο κωδικός στον τιμοκατάλογο/τιμολόγιό του — μοναδικός ανά προμηθευτή" />
      <BarcodeField label="Barcode (προαιρετικό)" name="barcode" defaultValue={s?.barcode ?? ""} hint="Αν διαφέρει από του καταλόγου, π.χ. κιβώτιο του προμηθευτή" />
      <Field label="Συσκευασίες ανά μονάδα παραγγελίας" name="packQty" required inputMode="numeric" defaultValue={String(s?.packQty ?? 1)} hint="π.χ. 12 αν πουλά σε κιβώτιο των 12" />
      <Submit className={btn("default")}>{s ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  // Ιστορικό τιμών + νέα τιμή/συμφωνία για μια σύνδεση προμηθευτή. Μόνο προσθήκες — το παρελθόν δεν πειράζεται.
  const priceModal = (s: (typeof supplierItems)[number]) => {
    const prices = ordered(s.prices, ["price", "min", "validFrom", "note"], (p, key) => key === "price" ? p.priceCents : key === "min" ? p.minPackQty ?? -1 : key === "validFrom" ? p.validFrom.getTime() : p.note ?? "");
    return (
      <Modal label={<><Euro /> Τιμές</>} size="lg" title={`Τιμές: ${s.supplier.name} — ${s.tradeItem.name}`}>
        <div className="grid gap-5">
          <form action={addSupplierItemPrice} className="grid gap-4 rounded-lg border border-border/70 p-4 [&>button]:justify-self-end">
            <input type="hidden" name="supplierItemId" value={s.id} />
            <input type="hidden" name="genericItemId" value={generic.id} />
            <Field label="Τιμή ανά συσκευασία, προ ΦΠΑ (€)" name="price" required inputMode="decimal" hint="π.χ. 12,40 — για μία συσκευασία, όχι για τη μονάδα παραγγελίας" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Ελάχιστη ποσότητα" name="minPackQty" inputMode="numeric" hint="Κενό = τιμοκατάλογος" />
              <Field label="Ισχύει από" name="validFrom" type="date" hint="Κενό = σήμερα" />
              <Field label="Ισχύει έως" name="validTo" type="date" hint="Κενό = ανοικτά" />
            </div>
            <Field label="Σημείωση" name="note" maxLength={120} hint="π.χ. «Συμφωνία έκθεσης 2026»" />
            <Submit className={btn("default")}>Καταχώριση τιμής</Submit>
          </form>
          <div className="overflow-hidden rounded-lg border border-border/70">
            <DataTable
              id={`supplier-prices-${s.id}`}
              listing={listing(prices.length, "Αναζήτηση τιμής…")}
              empty="Καμία τιμή ακόμα — η πρώτη καταχώριση είναι ο τιμοκατάλογος"
              columns={[
                { key: "price", label: "Τιμή", required: true, numeric: true, sortable: true },
                { key: "min", label: "Ελάχ.", numeric: true, sortable: true },
                { key: "validFrom", label: "Ισχύς", sortable: true },
                { key: "note", label: "Σημείωση", sortable: true },
              ]}
              rows={paginated(prices).map((p) => ({
                id: p.id,
                cells: {
                  price: euro(p.priceCents),
                  min: p.minPackQty ?? "—",
                  validFrom: `${dayFmt.format(p.validFrom)} → ${p.validTo ? dayFmt.format(p.validTo) : "ανοικτά"}`,
                  note: p.note ?? "",
                },
                details: {
                  label: `Τιμή ${euro(p.priceCents)}`,
                  view: <dl className="grid gap-4 sm:grid-cols-3">
                    <div><dt className="text-xs text-muted-foreground">Καταχώριση</dt><dd className="font-medium">{p.createdByName}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Ελάχιστη ποσότητα</dt><dd className="font-medium">{p.minPackQty ?? "Τιμοκατάλογος"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Σημείωση</dt><dd className="font-medium">{p.note ?? "—"}</dd></div>
                  </dl>,
                },
              }))}
            />
          </div>
        </div>
      </Modal>
    );
  };

  const stockRows = [
    ...stockByWarehouse.map((s) => ({
      id: `warehouse-${s.warehouseId}`,
      kind: "Αποθήκη",
      warehouse: warehouses.find((w) => w.id === s.warehouseId)?.name ?? "—",
      batch: "Συνολικό απόθεμα",
      expiry: "",
      expiryTime: 0,
      quantity: s._sum.quantity ?? 0,
    })),
    ...liveLots.map((l) => ({
      id: `lot-${l.id}`,
      kind: "Παρτίδα",
      warehouse: l.warehouse.name,
      batch: l.batchNumber ?? "(χύμα)",
      expiry: l.expiresAt ? dayFmt.format(l.expiresAt) : "Χωρίς λήξη",
      expiryTime: l.expiresAt?.getTime() ?? 0,
      quantity: lotQty.get(l.id) ?? 0,
    })),
  ];
  const sortedStock = ordered(stockRows, ["warehouse", "kind", "batch", "expiry", "quantity"], (r, key) => key === "quantity" ? r.quantity : key === "expiry" ? ("expiryTime" in r ? r.expiryTime : 0) : key === "kind" ? r.kind : key === "batch" ? r.batch : r.warehouse);
  const sortedMappings = ordered(generic.mappings, ["item", "brand", "ean", "content"], (m, key) => key === "item" ? m.tradeItem.name : key === "brand" ? m.tradeItem.brand ? `${normalizeManufacturerName(m.tradeItem.brand.manufacturer.name)} ${m.tradeItem.brand.name}` : "" : key === "ean" ? m.tradeItem.ean ?? "" : m.tradeItem.contentQty);
  const supplierRows = supplierItems.map((s) => ({ ...s, current: resolvePrice(s.prices, s.packQty, now) }));
  const sortedSuppliers = ordered(supplierRows, ["supplier", "item", "code", "pack", "price", "status"], (s, key) => key === "supplier" ? s.supplier.name : key === "item" ? s.tradeItem.name : key === "code" ? s.supplierCode ?? "" : key === "pack" ? s.packQty : key === "price" ? s.current?.priceCents ?? -1 : s.active ? 1 : 0);

  return (
    <Page section="Συνταγολόγιο" title={generic.name} description={`Μονάδα κατανάλωσης: ${generic.baseUnit.nameEL} (${generic.baseUnit.code})${generic.vatRate ? ` · ΦΠΑ αγοράς ${generic.vatRate.rate}%` : ""}`}>
      <div className="grid max-w-7xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι συνδέσεις ενημερώθηκαν{q.copied ? " — η σύσταση αντιγράφηκε από τον κατάλογο" : ""}</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Σύσταση</h2>
              <p className="text-sm text-muted-foreground">Τεχνικά χαρακτηριστικά ανά 100 g — τροφοδοτούν την ανάλυση συνταγών (PAC/POD, στερεά)</p>
            </div>
            {generic.composition ? <Badge tone="success">Καταχωρημένη</Badge> : <Badge tone="warning">Εκκρεμεί</Badge>}
            <Link href={`/items/${generic.id}/composition`} className={btn("ghost", "sm")}>
              <FlaskConical /> {generic.composition ? "Προβολή" : "Συμπλήρωση"}
            </Link>
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Απόθεμα & παρτίδες</h2>
              <p className="text-sm text-muted-foreground">Σε βασική μονάδα ({generic.baseUnit.code})· οι παρτίδες με λήξη οδηγούν την κατανάλωση (FEFO)</p>
            </div>
            {can("warehouses.edit") && warehouses.length ? (
              <Modal label={<><ClipboardEdit /> Διόρθωση</>} size="sm" title={`Διόρθωση αποθέματος: ${generic.name}`}>
                <form action={addCorrection} className="grid gap-4 [&>button]:justify-self-end">
                  <input type="hidden" name="genericItemId" value={generic.id} />
                  <Select label="Αποθήκη" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} />
                  <Field label={`Ποσότητα (${generic.baseUnit.code})`} name="qty" required inputMode="numeric" hint="Θετική για είσοδο, αρνητική για αφαίρεση — π.χ. -500 για μισό κιλό λιγότερο" />
                  <Field label="Αιτιολογία" name="note" required minLength={3} maxLength={120} hint="π.χ. «σπασίματα», «μέτρηση απογραφής», «άνοιγμα συσκευασίας»" />
                  <Submit className={btn("default")}>Καταχώριση</Submit>
                </form>
              </Modal>
            ) : null}
          </div>
          <DataTable
            id={`item-${generic.id}-stock`}
            listing={listing(sortedStock.length, "Αποθήκη ή παρτίδα…")}
            empty="Χωρίς κινήσεις ακόμα — το απόθεμα γεμίζει από τιμολόγια αγοράς ή διόρθωση"
            columns={[
              { key: "warehouse", label: "Αποθήκη", required: true, sortable: true },
              { key: "kind", label: "Εγγραφή", sortable: true },
              { key: "batch", label: "Παρτίδα", sortable: true },
              { key: "expiry", label: "Λήξη", sortable: true },
              { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
            ]}
            rows={paginated(sortedStock).map((r) => ({
              id: r.id,
              cells: {
                warehouse: <span className="font-semibold">{r.warehouse}</span>,
                kind: r.kind === "Παρτίδα" ? <Badge>Παρτίδα</Badge> : <Badge tone="success">Αποθήκη</Badge>,
                batch: r.batch,
                expiry: r.expiry || "—",
                quantity: fmt(r.quantity),
              },
              details: {
                label: `${r.warehouse} · ${r.batch}`,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Αποθήκη</dt><dd className="font-medium">{r.warehouse}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Παρτίδα</dt><dd className="font-medium">{r.batch}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Λήξη</dt><dd className="font-medium">{r.expiry || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Υπόλοιπο</dt><dd className="font-medium">{fmt(r.quantity)}</dd></div>
                </dl>,
              },
            }))}
          />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Συσκευασίες</h2>
              <p className="text-sm text-muted-foreground">Τα εμπορικά είδη που τροφοδοτούν το «{generic.name}» — από τον κεντρικό κατάλογο ή ιδιωτικά</p>
            </div>
            {can("items.edit") ? <Modal label={<><ScanBarcode /> Σύνδεση με barcode</>} size="sm" title={`Σύνδεση συσκευασίας: ${generic.name}`}>{mappingForm}</Modal> : null}
          </div>
          <DataTable
            id={`item-${generic.id}-mappings`}
            listing={listing(sortedMappings.length, "Συσκευασία ή barcode…")}
            bulkActions={can("items.edit") ? [{ value: "remove", label: "Αποσύνδεση επιλεγμένων", confirm: "Αποσύνδεση των επιλεγμένων συσκευασιών;", run: removeMappings.bind(null, generic.id) }] : []}
            empty="Καμία συσκευασία ακόμα — σάρωσε το barcode της για σύνδεση με τον κεντρικό κατάλογο"
            columns={[
              { key: "item", label: "Είδος", required: true, sortable: true },
              { key: "brand", label: "Μάρκα", sortable: true },
              { key: "ean", label: "EAN", sortable: true },
              { key: "content", label: "Περιεχόμενο", numeric: true, sortable: true },
            ]}
            rows={paginated(sortedMappings).map((m) => ({
              id: m.id,
              cells: {
                item: <span className="font-semibold">{m.tradeItem.name} {m.tradeItem.orgId ? <Badge>ιδιωτικό</Badge> : null}</span>,
                brand: m.tradeItem.brand ? `${normalizeManufacturerName(m.tradeItem.brand.manufacturer.name)} · ${m.tradeItem.brand.name}` : "—",
                ean: <span className="tabular-nums">{m.tradeItem.ean ?? "—"}</span>,
                content: content(m.tradeItem),
              },
              details: {
                label: m.tradeItem.name,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Είδος</dt><dd className="font-medium">{m.tradeItem.name}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Μάρκα</dt><dd className="font-medium">{m.tradeItem.brand?.name ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Barcode</dt><dd className="font-medium">{m.tradeItem.ean ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Περιεχόμενο</dt><dd className="font-medium">{content(m.tradeItem)}</dd></div>
                </dl>,
              },
              menu: can("items.edit") ? <form action={removeMapping.bind(null, m.id, generic.id)}><Submit className={menuItem}><Trash2 /> Αποσύνδεση</Submit></form> : undefined,
            }))}
          />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Προμηθευτές</h2>
              <p className="text-sm text-muted-foreground">Ποιος πουλά ποια συσκευασία, με ποιον κωδικό — ο ίδιος κωδικός προμηθευτή δείχνει πάντα στο ίδιο είδος</p>
            </div>
            {can("items.add") && generic.mappings.length && suppliers.length ? <Modal label={<><Plus /> Σύνδεση προμηθευτή</>} size="sm" title={`Προμηθευτής για: ${generic.name}`}>{supplierForm()}</Modal> : null}
          </div>
          <DataTable
            id={`item-${generic.id}-suppliers`}
            listing={listing(sortedSuppliers.length, "Προμηθευτής ή κωδικός…")}
            bulkActions={can("items.edit") ? [
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateSupplierItems.bind(null, generic.id) },
              { value: "hide", label: "Απενεργοποίηση επιλεγμένων", confirm: "Απενεργοποίηση των επιλεγμένων συνδέσεων προμηθευτών;", run: hideSupplierItems.bind(null, generic.id) },
            ] : []}
            empty={!suppliers.length ? <>Κανένας προμηθευτής ακόμα — πρόσθεσέ τον στους <Link href="/parties" className="underline">Συναλλασσόμενους</Link> με ρόλο «προμηθευτής»</> : !generic.mappings.length ? "Σύνδεσε πρώτα μια συσκευασία" : "Καμία σύνδεση προμηθευτή ακόμα"}
            columns={[
              { key: "supplier", label: "Προμηθευτής", required: true, sortable: true },
              { key: "item", label: "Συσκευασία", sortable: true },
              { key: "code", label: "Κωδικός", sortable: true },
              { key: "pack", label: "Πολλαπλότητα", numeric: true, sortable: true },
              { key: "price", label: "Τρέχουσα τιμή", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={paginated(sortedSuppliers).map((s) => ({
              id: s.id,
              cells: {
                supplier: <Link href={`/parties/${s.supplierId}`} className="font-semibold hover:underline">{s.supplier.name}</Link>,
                item: s.tradeItem.name,
                code: <span className="tabular-nums">{s.supplierCode ?? "—"}</span>,
                pack: `×${s.packQty}`,
                price: s.current ? euro(s.current.priceCents) : "—",
                status: s.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Ανενεργή</Badge>,
              },
              details: {
                label: `${s.supplier.name} · ${s.tradeItem.name}`,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Κωδικός προμηθευτή</dt><dd className="font-medium">{s.supplierCode ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Barcode</dt><dd className="font-medium">{s.barcode ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Πολλαπλότητα</dt><dd className="font-medium">×{s.packQty}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Τρέχουσα τιμή</dt><dd className="font-medium">{s.current ? euro(s.current.priceCents) : "—"}</dd></div>
                </dl>,
                edit: can("items.edit") ? supplierForm(s) : undefined,
              },
              actions: can("items.edit") ? priceModal(s) : undefined,
              menu: can("items.edit") ? <form action={toggleSupplierItem.bind(null, s.id, generic.id)}><Submit className={menuItem}>{s.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : undefined,
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
