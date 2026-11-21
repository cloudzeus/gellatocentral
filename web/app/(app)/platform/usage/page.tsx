import { Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { saveUsagePrice, toggleUsagePrice } from "./actions";

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

// Pay-as-you-go υπηρεσίες: τιμολογιακή πολιτική (markup πάνω στο κόστος του παρόχου) και κατανάλωση τρέχοντος μήνα.
// Η ίδια δομή θα σηκώσει και τις επόμενες (sms, maps, AI agent ανά πελάτη) — μία γραμμή UsagePrice η καθεμία.
export default async function UsagePage({ searchParams }: PageProps<"/platform/usage">) {
  await requirePlatform("billing.read");
  const q = await searchParams;
  const [services, usage, orgs] = await Promise.all([
    db.usagePrice.findMany({ orderBy: { service: "asc" } }),
    db.usageEvent.groupBy({ by: ["orgId", "service"], where: { createdAt: { gte: monthStart() } }, _sum: { units: true, chargeCents: true, costUsd: true }, _count: { _all: true }, orderBy: { _sum: { chargeCents: "desc" } } }),
    db.organization.findMany({ select: { id: true, name: true } }),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const labelOf = new Map(services.map((s) => [s.service, s.label]));

  const serviceForm = (s?: (typeof services)[number]) => (
    <form key={s?.service ?? "new"} action={saveUsagePrice} className="grid gap-4 [&>button]:justify-self-end">
      <Field label="Κλειδί υπηρεσίας" name="service" required maxLength={30} defaultValue={s?.service} disabled={Boolean(s)}
        hint={s ? "Δεν αλλάζει: με αυτό γράφονται τα UsageEvent" : "2–30 μικρά λατινικά, αριθμοί ή παύλες, π.χ. ocr"} />
      <Field label="Ονομασία" name="label" required maxLength={60} defaultValue={s?.label} hint="Πώς φαίνεται στον συνδρομητή, π.χ. «Ανάγνωση τιμολογίου (OCR)»" />
      <Field label="Μονάδα χρέωσης" name="unitLabel" required maxLength={40} defaultValue={s?.unitLabel} hint="π.χ. «ανά έγγραφο»" />
      <Field label="Markup επί του κόστους (%)" name="markupPercent" required inputMode="numeric" defaultValue={String(s?.markupPercent ?? 30)} hint="Η χρέωση = κόστος παρόχου × ισοτιμία USD→EUR × (1 + markup)" />
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} className="size-4 accent-[var(--primary)]" /> Ενεργή — οι συνδρομητές μπορούν να τη χρησιμοποιούν</label>
      <Submit className={btn("default")}>{s ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Πλατφόρμα" title="Υπηρεσίες pay-as-you-go" description="Υπηρεσίες που χρεώνονται ανά χρήση (OCR τιμολογίων, αύριο sms/maps). Το markup το ορίζεις εδώ· ο συνδρομητής βλέπει την κατανάλωσή του στη Συνδρομή">
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι υπηρεσίες ενημερώθηκαν</p> : null}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Υπηρεσίες</h2><p className="text-sm text-muted-foreground">{services.length ? `${services.filter((s) => s.active).length} ενεργές από ${services.length}` : "Καμία υπηρεσία ακόμα"}</p></div>
            <Modal label={<><Plus /> Νέα υπηρεσία</>} size="sm" title="Νέα pay-as-you-go υπηρεσία">{serviceForm()}</Modal>
          </div>
          {services.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Κλειδί</th><th className="px-3 py-2 font-semibold">Ονομασία</th><th className="px-3 py-2 font-semibold">Χρέωση</th><th className="px-3 py-2 text-right font-semibold">Markup</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.service} className="border-t border-border/70">
                      <td className="px-5 py-2 font-mono text-xs">{s.service}</td>
                      <td className="px-3 py-2 font-medium">{s.label}</td>
                      <td className="px-3 py-2">{s.unitLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.markupPercent}%</td>
                      <td className="px-3 py-2">{s.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Κλειστή</Badge>}</td>
                      <td className="px-5 py-1.5">
                        <span className="flex justify-end gap-1">
                          <Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={s.label}>{serviceForm(s)}</Modal>
                          <form action={toggleUsagePrice.bind(null, s.service)}><Submit className={btn("ghost", "sm")}>{s.active ? "Κλείσιμο" : "Άνοιγμα"}</Submit></form>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία υπηρεσία ακόμα. Πρόσθεσε την πρώτη με το «Νέα υπηρεσία»</p>}
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Κατανάλωση τρέχοντος μήνα</h2>
            <p className="text-sm text-muted-foreground">Ανά συνδρομητή και υπηρεσία — η χρέωση μπαίνει στον επόμενο λογαριασμό συνδρομής</p>
          </div>
          {usage.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Συνδρομητής</th><th className="px-3 py-2 font-semibold">Υπηρεσία</th><th className="px-3 py-2 text-right font-semibold">Χρήσεις</th><th className="px-3 py-2 text-right font-semibold">Κόστος (USD)</th><th className="px-3 py-2 text-right font-semibold">Χρέωση</th></tr></thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={`${u.orgId}-${u.service}`} className="border-t border-border/70">
                      <td className="px-5 py-2 font-medium">{orgName.get(u.orgId) ?? u.orgId}</td>
                      <td className="px-3 py-2">{labelOf.get(u.service) ?? u.service}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u._sum.units ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(u._sum.costUsd ?? 0).toFixed(4)} $</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{euro(u._sum.chargeCents ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία χρήση αυτόν τον μήνα</p>}
        </Card>
      </div>
    </Page>
  );
}
