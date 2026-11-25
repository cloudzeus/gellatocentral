import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { B2bAccessForm } from "@/components/b2b-access-form";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

export default async function B2bManagementPage() {
  const ctx = await requireStockContext("wholesale.read");
  const [customers, accesses] = await Promise.all([
    db.party.findMany({ where: { orgId: ctx.orgId, active: true, roles: { has: "customer" } }, orderBy: { name: "asc" } }),
    db.b2bAccess.findMany({ where: { orgId: ctx.orgId } }),
  ]);
  const byCustomer = new Map(accesses.map((access) => [access.customerId, access]));
  return <Page section="Πελάτες & πωλήσεις" title="Πρόσβαση B2B" description="Προσωπικοί σύνδεσμοι πελατών· αποθηκεύεται μόνο SHA-256 hash του κάθε token" actions={<Link href="/wholesale-orders" className={btn("outline", "sm")}><ArrowLeft /> Παραγγελίες</Link>}>
    <div className="grid gap-3">{customers.map((customer) => { const access = byCustomer.get(customer.id); return <Card key={customer.id} className="grid gap-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{customer.name}</h2><p className="text-sm text-muted-foreground">{access ? `Δημιουργήθηκε ${new Intl.DateTimeFormat("el-GR").format(access.createdAt)}${access.expiresAt ? ` · λήγει ${new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(access.expiresAt)}` : ""}` : "Δεν έχει δημιουργηθεί σύνδεσμος"}</p></div>{access ? <StatusBadge look={look(access.active ? "success" : "neutral", access.active ? "Ενεργός" : "Ανενεργός")} /> : null}</div>{ctx.can("wholesale.edit") ? <B2bAccessForm customerId={customer.id} /> : null}</Card>; })}{!customers.length ? <Card className="p-8 text-center text-sm text-muted-foreground">Δημιούργησε πρώτα πελάτες στους Συναλλασσόμενους.</Card> : null}</div>
  </Page>;
}
