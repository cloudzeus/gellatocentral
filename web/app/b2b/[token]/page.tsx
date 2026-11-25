import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { stockCostScale } from "@/lib/units";
import { outstandingCents, selectPriceList } from "@/lib/wholesale";
import { b2bContext } from "@/lib/wholesale-db";
import { submitB2bOrder } from "./actions";

// Το περιεχόμενο εξαρτάται πάντα από το προσωπικό token και από τρέχοντα δεδομένα.
export const instant = false;

const STATUS = { DRAFT: "Σε καταχώριση", CONFIRMED: "Επιβεβαιωμένη", DELIVERED: "Παραδόθηκε", INVOICED: "Τιμολογήθηκε", CANCELLED: "Ακυρωμένη" } as const;

export default async function B2bPage({ params, searchParams }: PageProps<"/b2b/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  let access;
  try { access = await b2bContext(token); } catch { return <main className="mx-auto max-w-2xl p-6"><Card className="p-6"><h1 className="text-xl font-semibold">Ο σύνδεσμος δεν είναι διαθέσιμος</h1><p className="mt-2 text-sm text-muted-foreground">Ζήτα νέο προσωπικό σύνδεσμο από την επιχείρηση.</p></Card></main>; }
  const orgId = access.orgId;
  const customerId = access.customerId;
  const [customer, lists, links, orders] = await Promise.all([
    db.party.findFirst({ where: { id: customerId, orgId, active: true, roles: { has: "customer" } } }),
    db.priceList.findMany({ where: { orgId, active: true, validFrom: { lte: new Date() }, AND: [{ OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, { OR: [{ parties: { none: {} } }, { parties: { some: { partyId: customerId } } }] }] }, include: { parties: true, items: true } }),
    db.storeWarehouse.findMany({ where: { store: { orgId, active: true }, warehouse: { orgId, active: true } }, include: { store: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } }, orderBy: [{ store: { name: "asc" } }, { priority: "asc" }] }),
    db.wholesaleOrder.findMany({ where: { orgId, customerId }, include: { lines: true, documents: { include: { allocations: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!customer) return <main className="mx-auto max-w-2xl p-6"><Card className="p-6"><h1 className="text-xl font-semibold">Ο λογαριασμός πελάτη δεν είναι ενεργός</h1></Card></main>;
  const genericIds = [...new Set(lists.flatMap((list) => list.items.map((item) => item.genericItemId)))];
  const generics = await db.genericItem.findMany({ where: { orgId, id: { in: genericIds }, active: true, trackStock: true }, include: { baseUnit: true }, orderBy: { name: "asc" } });
  const catalog = generics.flatMap((generic) => {
    const price = selectPriceList(lists, customerId, generic.id, new Date());
    return price ? [{ ...generic, price, scale: stockCostScale(generic.baseUnit.dimension), unitLabel: generic.baseUnit.dimension === "mass" ? "kg" : generic.baseUnit.dimension === "volume" ? "l" : "1000 τεμ." }] : [];
  });
  const repeat = typeof query.repeat === "string" ? orders.find((order) => order.id === query.repeat) : null;
  const repeatQuantities = new Map(repeat?.lines.map((line) => [line.genericItemId, line.quantityBase]));
  const outstanding = orders.flatMap((order) => order.documents).reduce((sum, document) => sum + outstandingCents(document, document.allocations), 0);
  return <main className="mx-auto max-w-6xl p-4 py-8 sm:p-6">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">{access.org.name} · B2B</p><h1 className="text-2xl font-semibold">{customer.name}</h1><p className="mt-1 text-sm text-muted-foreground">Παραγγελίες με τις προσωπικές τιμές και το ιστορικό του λογαριασμού σου.</p></div><Card className="px-4 py-3 text-sm">Απλήρωτο <strong className="ml-2">{euro(outstanding)}</strong></Card></header>
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section><h2 className="mb-3 text-lg font-semibold">Νέα παραγγελία</h2>{typeof query.error === "string" ? <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}{typeof query.saved === "string" ? <p role="status" className="mb-3 rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}<form action={submitB2bOrder} className="grid gap-4"><input type="hidden" name="token" value={token} /><input type="hidden" name="externalKey" value={randomUUID()} /><Card className="grid gap-3 p-4 sm:grid-cols-2"><Select label="Κατάστημα" name="storeId" required options={links.map((link): [string, string] => [link.storeId, link.store.name])} /><Select label="Αποθήκη παράδοσης" name="warehouseId" required options={links.map((link): [string, string] => [link.warehouseId, link.warehouse.name])} /><Field label="Επιθυμητή ημερομηνία" name="neededAt" type="date" /><TextareaField label="Σημείωση" name="note" maxLength={500} /></Card><div className="grid gap-2">{catalog.map((item) => <Card key={item.id} className="grid items-end gap-3 p-3 sm:grid-cols-[1fr_9rem_8rem]"><input type="hidden" name="genericItemId" value={item.id} /><input type="hidden" name={`scale:${item.id}`} value={item.scale} /><div><h3 className="font-medium">{item.name}</h3><p className="text-sm text-muted-foreground">{euro(item.price.unitPriceCents)} / {item.unitLabel} · ΦΠΑ {item.price.vatRate}%</p></div><Field label={`Ποσότητα (${item.unitLabel})`} name={`quantity:${item.id}`} inputMode="decimal" min={0} step="any" defaultValue={repeatQuantities.has(item.id) ? String((repeatQuantities.get(item.id)! / item.scale)) : "0"} /><span className="pb-2 text-xs text-muted-foreground">Οι τελικές τιμές ελέγχονται ξανά στον server.</span></Card>)}{!catalog.length ? <Card className="p-6 text-sm text-muted-foreground">Δεν υπάρχουν ενεργές τιμές για τον λογαριασμό σου.</Card> : null}</div><Submit disabled={!catalog.length || !links.length} className={btn("default", "lg", "justify-self-end")}>Υποβολή παραγγελίας</Submit></form></section>
      <aside><h2 className="mb-3 text-lg font-semibold">Ιστορικό</h2><div className="grid gap-3">{orders.map((order) => <Card key={order.id} className="p-4"><div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">{order.number}</h3><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(order.createdAt)}</p></div><Badge tone={order.status === "CANCELLED" ? "danger" : ["DELIVERED", "INVOICED"].includes(order.status) ? "success" : "warning"}>{STATUS[order.status]}</Badge></div><p className="mt-2 text-sm">{order.lines.length} είδη · <strong>{euro(order.totalCents)}</strong></p><Link href={`/b2b/${token}?repeat=${order.id}`} className="mt-3 inline-block text-sm font-medium underline">Επανάληψη παραγγελίας</Link>{order.documents.length ? <ul className="mt-3 grid gap-1 border-t border-border/60 pt-2 text-xs">{order.documents.map((document) => <li key={document.id} className="flex justify-between"><span>{document.docType} · {document.series}-{document.aa}{document.status === "CANCELLED" ? " · ακυρωμένο" : ""}</span><span>{euro(document.totalCents)}</span></li>)}</ul> : null}</Card>)}{!orders.length ? <Card className="p-6 text-sm text-muted-foreground">Δεν υπάρχουν παραγγελίες.</Card> : null}</div></aside>
    </div>
  </main>;
}
