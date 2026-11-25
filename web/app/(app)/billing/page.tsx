import { CircleCheck, CreditCard, Info, Lock, Pause, Play, Snowflake, Store } from "lucide-react";
import { TrendChart } from "@/components/charts";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEVICE_KIND } from "@/lib/devices";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { euro } from "@/lib/money";
import { billableStores, planOf } from "@/lib/plan-data";
import { type ChargeLine, daysBetween, MIN_PAUSE_DAYS, monthlyPreview, pauseDaysLeft, pausedMonthly, storeMonthly } from "@/lib/plans";
import { VAT_RATE, withVat } from "@/lib/pricing";
import { pauseStore, payCharge, resumeStore } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const day = (d: Date) => d.toLocaleDateString("el-GR");
const month = new Intl.DateTimeFormat("el-GR", { month: "short", year: "2-digit" });
/** «2 ταμεία Android, 1 ψυγείο» */
const deviceText = (kinds: string[]) => Object.entries(kinds.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([k, n]) => `${n} × ${DEVICE_KIND[k as keyof typeof DEVICE_KIND]?.label ?? k}`).join(", ") || "χωρίς συσκευές";

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { org, permissions } = await currentOrg("billing.read");
  const q = await searchParams;
  const now = new Date();
  const [plan, stores, sub] = await Promise.all([planOf(org.id), billableStores(org.id), db.subscription.findUnique({ where: { orgId: org.id }, include: { charges: { orderBy: { periodStart: "desc" }, take: 12 } } })]);
  const preview = monthlyPreview(plan, stores.map((s) => ({ ...s, paused: !!s.paused })));
  const saving = preview.fullCents - preview.totalCents;
  // κατανάλωση pay-as-you-go υπηρεσιών του τρέχοντος μήνα (OCR κ.ά.) — τη βλέπει ο συνδρομητής εδώ
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await db.usageEvent.groupBy({ by: ["service"], where: { orgId: org.id, createdAt: { gte: monthStart } }, _sum: { units: true, chargeCents: true } });
  const usageLabels = usage.length ? new Map((await db.usagePrice.findMany({ where: { service: { in: usage.map((u) => u.service) } } })).map((p) => [p.service, p])) : new Map();
  const canPause = permissions.includes("stores.pause");
  const chargesTotal = sub ? await db.subscriptionCharge.count({ where: { subscriptionId: sub.id } }) : 0;
  const open = sub?.charges.filter((x) => !x.paidAt) ?? [];
  const closes = plan.modules.filter((m) => !plan.pausedModules.includes(m)).map((m) => MODULES[m as ModuleKey]?.label).filter(Boolean);
  const stays = plan.modules.filter((m) => plan.pausedModules.includes(m)).map((m) => MODULES[m as ModuleKey]?.label).filter(Boolean);
  const history = [...(sub?.charges ?? [])].reverse().map((c) => {
    const lines = (Array.isArray(c.lines) ? c.lines : []) as unknown as ChargeLine[];
    const full = lines.length ? lines.reduce((s, l) => s + l.fullCents, 0) : c.amountCents;
    return { label: month.format(c.periodStart), current: c.amountCents, previous: full, highlight: full > c.amountCents };
  });

  return (
    <Page section="Ρυθμίσεις" title="Συνδρομή" description="Τι πληρώνεις, για ποια καταστήματα, και πώς κλείνεις ένα κατάστημα για την περίοδο που δεν δουλεύει">
      <div className="max-w-7xl space-y-4">
        {q.error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {String(q.error).slice(0, 200)}</p> : null}

        {open.map((x) => (
          <Card key={x.id} className="flex flex-wrap items-center gap-4 border-gold/60 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Προς πληρωμή: {euro(withVat(x.amountCents))}</h2>
              <p className="text-sm text-muted-foreground">Περίοδος {day(x.periodStart)} – {day(x.periodEnd)} · {euro(x.amountCents)} + ΦΠΑ {VAT_RATE}% · πληρωτέο μέχρι {day(x.periodStart)}</p>
            </div>
            <form action={payCharge.bind(null, x.id)}><Submit className={btn("default", "lg")}><CreditCard /> Πληρωμή με κάρτα</Submit></form>
          </Card>
        ))}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Μηνιαία χρέωση σήμερα</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{euro(preview.totalCents)}</p>
            <p className="text-sm text-muted-foreground">προ ΦΠΑ · {euro(withVat(preview.totalCents))} με ΦΠΑ{sub?.creditCents ? ` · πιστωτικό υπόλοιπο ${euro(sub.creditCents)} για την επόμενη χρέωση` : ""}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Γλιτώνεις με την παύση</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${saving ? "text-success-ink" : ""}`}>{euro(saving)}</p>
            <p className="text-sm text-muted-foreground">{saving ? `τον μήνα · ${stores.filter((s) => s.paused).length} κατάστημα σε παύση στο ${plan.pausePercent}%` : `κανένα κατάστημα σε παύση · στην παύση πληρώνεις το ${plan.pausePercent}%`}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Πακέτο</p>
            <p className="mt-1 text-2xl font-semibold">{plan.name}</p>
            <p className="text-sm text-muted-foreground">{plan.modules.length} ενότητες · {euro(plan.storeCents)} το κατάστημα</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Συνδρομή</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{sub ? day(sub.currentPeriodEnd) : "—"}</p>
            <p className="text-sm text-muted-foreground">{sub ? (sub.currentPeriodEnd > now ? "ισχύει μέχρι τότε" : "έχει λήξει: πλήρωσε την ανοιχτή χρέωση") : "δεν έχει οριστεί ακόμα"}</p>
          </Card>
        </div>

        <Card id="stores" className="scroll-mt-28">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Τα καταστήματά σου</h2>
            <p className="text-sm text-muted-foreground">Κάθε κατάστημα πληρώνει {euro(plan.storeCents)} και τις συσκευές του. Εποχιακό κατάστημα; Βάλ&apos; το σε παύση όσο είναι κλειστό</p>
          </div>
          <ul className="divide-y divide-border/70">
            {stores.map((s) => {
              const m = storeMonthly(plan, s.deviceKinds);
              const pausedCents = pausedMonthly(plan, m.fullCents);
              const left = pauseDaysLeft(plan.pauseMaxDaysPerYear, s.pauses, now);
              const days = s.paused ? daysBetween(s.paused.startedAt, now) : 0;
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 ${s.paused ? "bg-gold/5" : ""}`}>
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${s.paused ? "bg-gold/15 text-gold-ink" : "bg-success/10 text-success-ink"}`}>{s.paused ? <Snowflake className="size-4" /> : <Store className="size-4" />}</span>
                  <div className="min-w-0 basis-56 flex-1">
                    <p className="font-semibold">{s.name} <StatusBadge look={s.paused ? look("warning", `Σε παύση ${days} ${days === 1 ? "ημέρα" : "ημέρες"}`) : look("success", "Σε λειτουργία")} /></p>
                    <p className="text-sm text-muted-foreground">
                      {s.paused
                        ? `από ${day(s.paused.startedAt)} · ${days < MIN_PAUSE_DAYS ? `η έκπτωση ξεκλειδώνει σε ${MIN_PAUSE_DAYS - days} ημέρες και μετρά από την πρώτη` : `κανονικά ${euro(m.fullCents)}, τώρα το ${plan.pausePercent}%`}`
                        : `κατάστημα ${euro(m.storeCents)} + ${deviceText(s.deviceKinds)} ${euro(m.devicesCents)}`}
                    </p>
                  </div>
                  <p className="text-right"><b className="block text-lg tabular-nums">{euro(s.paused ? pausedCents : m.fullCents)}</b><span className="text-xs text-muted-foreground">τον μήνα</span></p>
                  {!canPause ? null : s.paused ? (
                    <form action={resumeStore.bind(null, s.id)}><Submit className={btn("default")}><Play /> Άνοιγμα ξανά</Submit></form>
                  ) : (
                    <Modal label={<><Pause /> Παύση</>} size="sm" title={`Παύση: ${s.name}`} description="Κλείνεις το κατάστημα για την περίοδο που δεν δουλεύει και πληρώνεις λιγότερο">
                      <div className="grid gap-3 text-sm">
                        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-secondary p-3">
                          <dt>Τώρα πληρώνεις</dt><dd className="text-right font-semibold tabular-nums">{euro(m.fullCents)}</dd>
                          <dt className="text-success-ink">Σε παύση ({plan.pausePercent}%)</dt><dd className="text-right font-semibold tabular-nums text-success-ink">{euro(pausedCents)}</dd>
                        </dl>
                        <div><p className="font-semibold">Τι κλείνει</p><ul className="mt-1 space-y-1">{closes.map((l) => <li key={l} className="flex items-center gap-2"><Lock className="size-3.5 text-muted-foreground" aria-hidden />{l}</li>)}</ul></div>
                        <div><p className="font-semibold">Τι μένει ανοιχτό</p><ul className="mt-1 space-y-1">{[...stays, "Συνδρομή, χρήστες, υποστήριξη"].map((l) => <li key={l} className="flex items-center gap-2"><CircleCheck className="size-3.5 text-success-ink" aria-hidden />{l}</li>)}</ul></div>
                        <p className="flex gap-2 rounded-lg bg-gold/10 p-3"><Info className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden /><span>Η έκπτωση ισχύει αν η παύση κρατήσει <b>τουλάχιστον {MIN_PAUSE_DAYS} ημέρες</b> και τότε μετρά από την πρώτη ημέρα· τη βλέπεις στην επόμενη χρέωση. Αν ανοίξεις νωρίτερα, χρεώνεσαι κανονικά. Ανοίγεις ξανά όποτε θες, μόνος σου. Μένουν <b>{left} ημέρες</b> παύσης για αυτό το κατάστημα</span></p>
                        {left > 0 ? <form action={pauseStore.bind(null, s.id)} className="justify-self-end"><Submit className={btn("default")}><Pause /> Παύση από σήμερα</Submit></form> : <p role="alert" className="font-medium text-destructive">Δεν μένουν ημέρες παύσης για το τελευταίο 12μηνο</p>}
                      </div>
                    </Modal>
                  )}
                </li>
              );
            })}
            {stores.length ? null : <li className="px-5 py-6 text-sm text-muted-foreground">Δεν έχει οριστεί κατάστημα ακόμα</li>}
          </ul>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Χρεώσεις ανά μήνα</h2>
            <p className="text-sm text-muted-foreground">Οι χρυσές στήλες είναι μήνες με έκπτωση παύσης· η διακεκομμένη γραμμή δείχνει τι θα πλήρωνες χωρίς παύση</p>
          </div>
          {history.length ? (
            <div className="pt-4"><TrendChart id="billing" data={history} currentLabel="Χρέωση (προ ΦΠΑ)" previousLabel="Χωρίς παύση" summary={`Χρεώσεις των τελευταίων ${history.length} μηνών`} /></div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Το γράφημα εμφανίζεται μόλις εκδοθεί η πρώτη χρέωση</p>}
          {sub?.charges.length ? (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {sub.charges.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 tabular-nums">{day(x.periodStart)} – {day(x.periodEnd)} <span className="text-muted-foreground">· {x.stores} καταστ., {x.devices} συσκευές{x.planName ? ` · ${x.planName}` : ""}</span></span>
                  <b className="tabular-nums">{euro(withVat(x.amountCents))}</b>
                  <StatusBadge look={x.paidAt ? look("success", `Πληρώθηκε ${day(x.paidAt)}`) : look("warning", "Απλήρωτη")} />
                </li>
              ))}
            </ul>
          ) : null}
          {chargesTotal > (sub?.charges.length ?? 0) ? <p className="border-t border-border/70 px-5 py-2.5 text-xs text-muted-foreground">Εμφανίζονται οι {(sub?.charges.length ?? 0)} πιο πρόσφατες από {chargesTotal}</p> : null}
        </Card>

        {usage.length ? (
          <Card>
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="text-lg">Υπηρεσίες ανά χρήση — τρέχων μήνας</h2>
              <p className="text-sm text-muted-foreground">Pay-as-you-go: χρεώνεσαι μόνο όσα χρησιμοποίησες. Μπαίνουν στον επόμενο λογαριασμό συνδρομής, προ ΦΠΑ</p>
            </div>
            <ul className="divide-y divide-border/70">
              {usage.map((u) => {
                const p = usageLabels.get(u.service);
                return (
                  <li key={u.service} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 font-medium">{p?.label ?? u.service}</span>
                    <span className="text-muted-foreground tabular-nums">{u._sum.units ?? 0} {p?.unitLabel ?? ""}</span>
                    <b className="tabular-nums">{euro(u._sum.chargeCents ?? 0)}</b>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
