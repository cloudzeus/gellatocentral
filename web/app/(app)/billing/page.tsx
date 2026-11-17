import { CreditCard } from "lucide-react";
import Link from "next/link";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { BILLABLE_KINDS, monthlyCharge, PRICE_PER_DEVICE, PRICE_PER_STORE } from "@/lib/pricing";
import { VAT_RATE, withVat } from "@/lib/viva/checkout";
import { payCharge } from "./actions";
import { Submit } from "@/components/submit";

const day = (d: Date) => d.toLocaleDateString("el-GR");

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { org } = await currentOrg("billing.view");
  const q = await searchParams;
  const [stores, devices, sub] = await Promise.all([
    db.store.count({ where: { orgId: org.id, active: true } }),
    db.device.count({ where: { orgId: org.id, active: true, kind: { in: [...BILLABLE_KINDS] } } }),
    db.subscription.findUnique({ where: { orgId: org.id }, include: { charges: { orderBy: { periodStart: "desc" }, take: 12 } } }),
  ]);
  const c = monthlyCharge(stores, devices);
  const rows = [
    { label: "Καταστήματα", count: stores, unit: PRICE_PER_STORE, cents: c.storesCents, color: "bg-chart-1" },
    { label: "Συσκευές τιμολόγησης", count: devices, unit: PRICE_PER_DEVICE, cents: c.devicesCents, color: "bg-chart-2" },
  ];
  const open = sub?.charges.filter((x) => !x.paidAt) ?? [];
  return (
    <Page section="Ρυθμίσεις" title="Συνδρομή" description="Πληρώνεις ανά κατάστημα και ανά ενεργή συσκευή τιμολόγησης. Τίποτα άλλο.">
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{String(q.error)}</p> : null}
        {q.paid ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success">Η πληρωμή ολοκληρώθηκε. Ευχαριστούμε.</p> : null}

        {open.map((x) => (
          <Card key={x.id} className="flex flex-wrap items-center gap-4 border-gold/60 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Προς πληρωμή: {euro(withVat(x.amountCents))}</h2>
              <p className="text-sm text-muted-foreground">Περίοδος {day(x.periodStart)} – {day(x.periodEnd)} · {euro(x.amountCents)} + ΦΠΑ {VAT_RATE}% · πληρωτέο μέχρι {day(x.periodStart)}</p>
            </div>
            <form action={payCharge.bind(null, x.id)}><Submit className={btn("default", "lg")}><CreditCard /> Πληρωμή με κάρτα</Submit></form>
          </Card>
        ))}

        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <Card className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Μηνιαία χρέωση με τη σημερινή χρήση</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{euro(c.totalCents)}</p>
            <p className="text-sm text-muted-foreground">προ ΦΠΑ · {euro(withVat(c.totalCents))} με ΦΠΑ</p>
            {sub ? <p className="mt-3 text-sm">Ισχύει μέχρι <b>{day(sub.currentPeriodEnd)}</b></p> : null}
            <p className="mt-3 text-sm text-muted-foreground">Θες να πληρώνεις λιγότερα; Απενεργοποίησε όποια συσκευή δεν χρησιμοποιείς στις <Link href="/devices" className="font-semibold underline">Συσκευές</Link>.</p>
          </Card>
          <Card className="space-y-5 p-6">
            <h2 className="text-lg">Από τι αποτελείται</h2>
            {rows.map((r) => (
              <div key={r.label} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">{r.count} × {euro(r.unit)} = <b className="text-foreground">{euro(r.cents)}</b></span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full rounded-full ${r.color}`} style={{ width: `${c.totalCents ? (r.cents / c.totalCents) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </Card>
        </div>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Ιστορικό χρεώσεων</h2></div>
          {sub?.charges.length ? (
            <ul className="divide-y divide-border/70">
              {sub.charges.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 tabular-nums">{day(x.periodStart)} – {day(x.periodEnd)} <span className="text-muted-foreground">· {x.stores} καταστ., {x.devices} συσκευές</span></span>
                  <b className="tabular-nums">{euro(withVat(x.amountCents))}</b>
                  {x.paidAt ? <Badge tone="success">Πληρώθηκε {day(x.paidAt)}</Badge> : <Badge tone="warning">Ανεξόφλητη</Badge>}
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία χρέωση ακόμα</p>}
        </Card>
      </div>
    </Page>
  );
}
