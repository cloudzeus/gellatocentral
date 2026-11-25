import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { OrderLinesEditor } from "@/components/order-lines-editor";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { newPriceList } from "../actions";

export default async function PriceListsPage({ searchParams }: PageProps<"/wholesale-orders/pricelists">) {
  const ctx = await requireStockContext("wholesale.read");
  const query = await searchParams;
  const [lists, customers, generics] = await Promise.all([
    db.priceList.findMany({ where: { orgId: ctx.orgId }, include: { items: true, parties: true }, orderBy: { validFrom: "desc" }, take: 100 }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "customer" }, active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true, trackStock: true }, include: { baseUnit: true, vatRate: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(customers.map((row) => [row.id, row.name]));
  const items = generics.map((item) => ({ id: item.id, name: item.name, scale: stockCostScale(item.baseUnit.dimension), unitLabel: item.baseUnit.dimension === "mass" ? "kg" : item.baseUnit.dimension === "volume" ? "l" : "1000 τεμ.", defaultVat: item.vatRate?.rate ?? 24 }));
  return <Page section="Πελάτες & πωλήσεις" title="Τιμοκατάλογοι χονδρικής" description="Γενικές και πελατειακές τιμές με χρονική ισχύ· οι B2B τιμές υπολογίζονται μόνο στον server" actions={<span className="flex gap-2"><Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{ctx.can("wholesale.edit") ? <Modal wide label={<><Plus /> Νέος τιμοκατάλογος</>} title="Νέος τιμοκατάλογος" description="Η ποσότητα στις γραμμές δεν χρησιμοποιείται· καταχώρισε μόνο είδος, τιμή και ΦΠΑ."><form action={newPriceList} className="grid gap-4"><div className="grid gap-3 md:grid-cols-4"><Field label="Όνομα" name="name" required maxLength={100} /><Select label="Πελάτης" name="customerId" options={[["", "Γενικός τιμοκατάλογος"], ...customers.map((row): [string, string] => [row.id, row.name])]} /><Field label="Ισχύς από" name="validFrom" type="datetime-local" required /><Field label="Ισχύς έως" name="validTo" type="datetime-local" /></div><OrderLinesEditor items={items} priceLabel="Τιμή χονδρικής" /><Submit className={btn("default", "default", "justify-self-end")}>Αποθήκευση τιμοκαταλόγου</Submit></form></Modal> : null}</span>}>
    <div className="grid gap-4">{typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}{typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}<div className="grid gap-3">{lists.map((list) => <Card key={list.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{list.name}</h2><p className="text-sm text-muted-foreground">{list.parties.length ? names.get(list.parties[0].partyId) ?? "Πελάτης" : "Γενικός"} · {new Intl.DateTimeFormat("el-GR").format(list.validFrom)} → {list.validTo ? new Intl.DateTimeFormat("el-GR").format(list.validTo) : "χωρίς λήξη"}</p></div><Badge tone={list.active ? "success" : "neutral"}>{list.active ? "Ενεργός" : "Ανενεργός"}</Badge></div><div className="mt-3 grid gap-1 text-sm">{list.items.map((item) => <div key={item.id} className="flex justify-between border-b border-border/50 py-1 last:border-0"><span>{generics.find((generic) => generic.id === item.genericItemId)?.name ?? "Είδος"}</span><span>{euro(item.unitPriceCents)} · ΦΠΑ {item.vatRate}%</span></div>)}</div></Card>)}{!lists.length ? <Card className="p-8 text-center text-sm text-muted-foreground">Δεν υπάρχουν τιμοκατάλογοι.</Card> : null}</div></div>
  </Page>;
}
