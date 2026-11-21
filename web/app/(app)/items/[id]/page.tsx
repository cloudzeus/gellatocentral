import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardEdit, Euro, FlaskConical, Pencil, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { resolvePrice } from "@/lib/purchase-pricing";
import { formatBaseQty } from "@/lib/units";
import { addCorrection, addMapping, addSupplierItemPrice, removeMapping, saveSupplierItem, toggleSupplierItem } from "../actions";

// Καρτέλα γενικού είδους: ποιες συσκευασίες του κεντρικού καταλόγου το τροφοδοτούν (υιοθεσία με
// barcode) και ποιοι προμηθευτές τις πουλάνε, με τον δικό τους κωδικό και την πολλαπλότητα.
export default async function GenericItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("items.read");
  const { id } = await params;
  const q = await searchParams;
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
  const priceModal = (s: (typeof supplierItems)[number]) => (
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
        {s.prices.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-semibold">Τιμή</th><th className="px-2 py-1 font-semibold">Ελάχ.</th><th className="px-2 py-1 font-semibold">Ισχύς</th><th className="px-2 py-1 font-semibold">Σημείωση</th></tr></thead>
            <tbody>
              {s.prices.map((p) => (
                <tr key={p.id} className="border-t border-border/70">
                  <td className="py-1.5 pr-2 font-medium tabular-nums">{euro(p.priceCents)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{p.minPackQty ?? "—"}</td>
                  <td className="px-2 py-1.5">{dayFmt.format(p.validFrom)} → {p.validTo ? dayFmt.format(p.validTo) : "ανοικτά"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{p.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-muted-foreground">Καμία τιμή ακόμα — η πρώτη καταχώριση είναι ο τιμοκατάλογος</p>}
      </div>
    </Modal>
  );

  return (
    <Page section="Συνταγολόγιο" title={generic.name} description={`Μονάδα κατανάλωσης: ${generic.baseUnit.nameEL} (${generic.baseUnit.code})${generic.vatRate ? ` · ΦΠΑ αγοράς ${generic.vatRate.rate}%` : ""}`}>
      <div className="grid max-w-5xl gap-4">
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {stockByWarehouse.length ? stockByWarehouse.map((s) => (
                  <tr key={s.warehouseId} className="border-t border-border/70 first:border-t-0">
                    <td className="px-5 py-2 font-medium">{warehouses.find((w) => w.id === s.warehouseId)?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(s._sum.quantity ?? 0)}</td>
                  </tr>
                )) : <tr><td className="px-5 py-4 text-sm text-muted-foreground">Χωρίς κινήσεις ακόμα — το απόθεμα γεμίζει από τιμολόγια αγοράς ή διόρθωση</td></tr>}
                {liveLots.map((l) => (
                  <tr key={l.id} className="border-t border-border/70 text-muted-foreground">
                    <td className="px-5 py-1.5 text-xs">παρτίδα {l.batchNumber ?? "(χύμα)"} · {l.warehouse.name}{l.expiresAt ? ` · λήξη ${dayFmt.format(l.expiresAt)}` : ""}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmt(lotQty.get(l.id) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Συσκευασίες</h2>
              <p className="text-sm text-muted-foreground">Τα εμπορικά είδη που τροφοδοτούν το «{generic.name}» — από τον κεντρικό κατάλογο ή ιδιωτικά</p>
            </div>
            {can("items.edit") ? <Modal label={<><ScanBarcode /> Σύνδεση με barcode</>} size="sm" title={`Σύνδεση συσκευασίας: ${generic.name}`}>{mappingForm}</Modal> : null}
          </div>
          {generic.mappings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Είδος</th><th className="px-3 py-2 font-semibold">Μάρκα</th><th className="px-3 py-2 font-semibold">EAN</th><th className="px-3 py-2 text-right font-semibold">Περιεχόμενο</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {generic.mappings.map((m) => (
                    <tr key={m.id} className="border-t border-border/70">
                      <td className="px-5 py-2 font-medium">{m.tradeItem.name}{m.tradeItem.orgId ? <Badge>ιδιωτικό</Badge> : null}</td>
                      <td className="px-3 py-2">{m.tradeItem.brand ? `${m.tradeItem.brand.manufacturer.name} · ${m.tradeItem.brand.name}` : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{m.tradeItem.ean ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{content(m.tradeItem)}</td>
                      <td className="px-5 py-1.5">
                        {can("items.edit") ? (
                          <span className="flex justify-end"><form action={removeMapping.bind(null, m.id, generic.id)}><Submit className={btn("ghost", "sm")}><Trash2 /> Αποσύνδεση</Submit></form></span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία συσκευασία ακόμα — σάρωσε το barcode της για σύνδεση με τον κεντρικό κατάλογο</p>}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Προμηθευτές</h2>
              <p className="text-sm text-muted-foreground">Ποιος πουλά ποια συσκευασία, με ποιον κωδικό — ο ίδιος κωδικός προμηθευτή δείχνει πάντα στο ίδιο είδος</p>
            </div>
            {can("items.add") && generic.mappings.length && suppliers.length ? <Modal label={<><Plus /> Σύνδεση προμηθευτή</>} size="sm" title={`Προμηθευτής για: ${generic.name}`}>{supplierForm()}</Modal> : null}
          </div>
          {supplierItems.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Προμηθευτής</th><th className="px-3 py-2 font-semibold">Συσκευασία</th><th className="px-3 py-2 font-semibold">Κωδικός</th><th className="px-3 py-2 text-right font-semibold">Πολλαπλότητα</th><th className="px-3 py-2 text-right font-semibold">Τρέχουσα τιμή</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {supplierItems.map((s) => {
                    const current = resolvePrice(s.prices, s.packQty, now);
                    return (
                    <tr key={s.id} className={cn("border-t border-border/70", s.active ? "" : "text-muted-foreground")}>
                      <td className="px-5 py-2 font-medium"><Link href={`/parties/${s.supplierId}`} className="hover:underline">{s.supplier.name}</Link></td>
                      <td className="px-3 py-2">{s.tradeItem.name}</td>
                      <td className="px-3 py-2 tabular-nums">{s.supplierCode ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">×{s.packQty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{current ? euro(current.priceCents) : "—"}</td>
                      <td className="px-3 py-2">{s.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Ανενεργή</Badge>}</td>
                      <td className="px-5 py-1.5">
                        <span className="flex justify-end gap-1">
                          {can("items.edit") ? <>{priceModal(s)}<Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={`${s.supplier.name} — ${s.tradeItem.name}`}>{supplierForm(s)}</Modal><form action={toggleSupplierItem.bind(null, s.id, generic.id)}><Submit className={btn("ghost", "sm")}>{s.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form></> : null}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              {!suppliers.length ? <>Κανένας προμηθευτής ακόμα — πρόσθεσέ τον στους <Link href="/parties" className="underline">Συναλλασσόμενους</Link> με ρόλο «προμηθευτής»</> : !generic.mappings.length ? "Σύνδεσε πρώτα μια συσκευασία" : "Καμία σύνδεση προμηθευτή ακόμα"}
            </p>
          )}
        </Card>
      </div>
    </Page>
  );
}
