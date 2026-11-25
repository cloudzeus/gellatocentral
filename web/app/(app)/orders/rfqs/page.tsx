import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { stockCostScale } from "@/lib/units";
import { newRfq } from "../actions";

export default async function RfqsPage({ searchParams }: PageProps<"/orders/rfqs">) {
  const query = await searchParams;
  const ctx = await requireStockContext("orders.read");
  const [rfqs, suppliers, generics] = await Promise.all([
    db.rfq.findMany({ where: { orgId: ctx.orgId }, include: { lines: true, suppliers: true }, orderBy: { createdAt: "desc" } }),
    db.party.findMany({ where: { orgId: ctx.orgId, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.genericItem.findMany({ where: { orgId: ctx.orgId, active: true }, include: { baseUnit: true }, orderBy: { name: "asc" } }),
  ]);
  return <Page section="Αποθήκη & αγορές" title="Αιτήματα προσφοράς" description="Σύγκριση προμηθευτών με ασφαλείς, προσωπικούς συνδέσμους" actions={<span className="flex gap-2"><Link href="/orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>{ctx.can("orders.add") ? <Modal wide size="sm" title="Νέο αίτημα προσφοράς" label={<><Plus /> Νέο RFQ</>}><form action={newRfq} className="grid gap-4"><Field label="Προθεσμία" name="replyBy" type="date" required /><fieldset className="grid gap-2"><legend className="text-sm font-medium">Προμηθευτές</legend>{suppliers.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="supplierIds" value={s.id} className="size-4" />{s.name}</label>)}</fieldset><div className="grid gap-2">{generics.map((g) => <div key={g.id} className="grid grid-cols-[1fr_10rem] items-end gap-2"><input type="hidden" name="genericItemId" value={g.id} /><p className="pb-2 text-sm">{g.name}</p><Field label={`Ποσότητα (${g.baseUnit.dimension === "mass" ? "kg" : g.baseUnit.dimension === "volume" ? "l" : "1000 τεμ."})`} name="quantity" inputMode="decimal" placeholder="0" data-scale={stockCostScale(g.baseUnit.dimension)} /></div>)}</div><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default", "default", "justify-self-end")} pendingText="Δημιουργία…">Δημιουργία & σύνδεσμοι</Submit></form></Modal> : null}</span>}><div className="grid gap-4">{typeof query.error === "string" ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}<Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">RFQ</th><th className="p-3">Προθεσμία</th><th className="p-3">Είδη</th><th className="p-3">Προσφορές</th><th className="p-3">Κατάσταση</th></tr></thead><tbody>{rfqs.map((rfq) => <tr key={rfq.id} className="border-b border-border/60 last:border-0"><td className="p-3"><Link href={`/orders/rfqs/${rfq.id}`} className="font-semibold hover:underline">{rfq.number}</Link></td><td className="p-3">{new Intl.DateTimeFormat("el-GR").format(rfq.replyBy)}</td><td className="p-3">{rfq.lines.length}</td><td className="p-3">{rfq.suppliers.filter((s) => s.respondedAt).length}/{rfq.suppliers.length}</td><td className="p-3"><Badge tone={rfq.status === "OPEN" ? "success" : "neutral"}>{rfq.status}</Badge></td></tr>)}</tbody></table>{!rfqs.length ? <p className="p-8 text-center text-sm text-muted-foreground">Κανένα αίτημα προσφοράς.</p> : null}</Card></div></Page>;
}
