import { ArrowRight, Banknote, CircleCheck, CreditCard, ReceiptText, Store, TabletSmartphone, Users } from "lucide-react";
import Link from "next/link";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { DEVICE_KIND, readingStatus } from "@/lib/devices";
import { currentOrg } from "@/lib/auth";

const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 864e5);
type Hour = { h: number; total: number };
type Method = { method: "CASH" | "CARD"; total: number; n: number };

export default async function DashboardPage() {
  const { org, permissions } = await currentOrg("dashboard.view");
  // «Σήμερα» = ημέρα Αθήνας (το issuedAt αποθηκεύεται σε UTC)
  const today = `("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')`;
  const [hours, methods, unsent, [{ total: yesterday }], devices, subscription] = await Promise.all([
    db.$queryRawUnsafe<Hour[]>(
      `SELECT extract(hour FROM ${today})::int AS h, sum("totalCents")::int AS total FROM "Sale"
       WHERE "orgId" = $1 AND status = 'COMPLETED' AND ${today}::date = (now() AT TIME ZONE 'Europe/Athens')::date GROUP BY 1 ORDER BY 1`,
      org.id,
    ),
    db.$queryRawUnsafe<Method[]>(
      `SELECT p.method, sum(p."amountCents")::int AS total, count(*)::int AS n FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId"
       WHERE s."orgId" = $1 AND s.status = 'COMPLETED' AND ${today.replaceAll('"issuedAt"', 's."issuedAt"')}::date = (now() AT TIME ZONE 'Europe/Athens')::date GROUP BY 1`,
      org.id,
    ),
    db.fiscalDocument.count({ where: { sale: { orgId: org.id, status: "COMPLETED" }, status: { not: "SIGNED" } } }),
    // χθες, όλη η ημέρα: το μέτρο σύγκρισης για το σημερινό σύνολο
    db.$queryRawUnsafe<{ total: number }[]>(
      `SELECT coalesce(sum("totalCents"), 0)::int AS total FROM "Sale"
       WHERE "orgId" = $1 AND status = 'COMPLETED' AND ${today}::date = (now() AT TIME ZONE 'Europe/Athens')::date - 1`,
      org.id,
    ),
    db.device.findMany({ where: { store: { orgId: org.id }, active: true }, include: { readings: { orderBy: { at: "desc" }, take: 1 } } }),
    db.subscription.findUnique({ where: { orgId: org.id } }),
  ]);

  // Ό,τι χρειάζεται ενέργεια σήμερα, με το πού πατάς για να το λύσεις
  type Issue = { tone: "danger" | "warning"; text: string; href: string; action: string };
  const issues: Issue[] = [];
  if (unsent > 0) issues.push({ tone: "danger", text: `${unsent} ${unsent === 1 ? "απόδειξη δεν έχει" : "αποδείξεις δεν έχουν"} διαβιβαστεί στην ΑΑΔΕ`, href: "/receipts", action: "Δες ποιες" });
  for (const d of devices) {
    const st = DEVICE_KIND[d.kind].measures ? readingStatus(d, d.readings[0]) : null;
    if (st && st.tone !== "success" && d.readings[0]) issues.push({ tone: st.tone === "danger" ? "danger" : "warning", text: `${d.name}: ${st.text}`, href: "/devices", action: "Συσκευές" });
    if (d.kind !== "POS_WEB" && !d.pairedAt) issues.push({ tone: "warning", text: `${d.name}: δεν έχει συνδεθεί ακόμα`, href: "/devices", action: "Σύζευξη" });
  }
  const daysLeft = subscription ? daysUntil(subscription.currentPeriodEnd) : null;
  if (daysLeft !== null && daysLeft <= 7) issues.push({ tone: daysLeft < 0 ? "danger" : "warning", text: daysLeft < 0 ? "Η συνδρομή έληξε" : `Η συνδρομή λήγει σε ${daysLeft} ${daysLeft === 1 ? "ημέρα" : "ημέρες"}`, href: "/billing", action: "Συνδρομή" });
  const shortcuts = [
    { href: "/pos", label: "Ταμείο", needs: "pos.use", icon: Store },
    { href: "/receipts", label: "Αποδείξεις", needs: "receipts.view", icon: ReceiptText },
    { href: "/devices", label: "Συσκευές", needs: "devices.manage", icon: TabletSmartphone },
    { href: "/users", label: "Χρήστες", needs: "users.manage", icon: Users },
  ].filter((x) => permissions.includes(x.needs));
  const total = methods.reduce((s, m) => s + m.total, 0);
  const count = methods.reduce((s, m) => s + m.n, 0);
  const by = (m: Method["method"]) => methods.find((x) => x.method === m)?.total ?? 0;
  const peak = Math.max(1, ...hours.map((h) => h.total));
  const best = hours.find((h) => h.total === peak);
  const vsYesterday = yesterday ? `Χθες όλη μέρα: ${euro(yesterday)}` : "Χθες δεν έγιναν πωλήσεις";
  const tiles = [
    { label: "Πωλήσεις σήμερα", value: euro(total), hint: count ? `${count} αποδείξεις · μέση ${euro(Math.round(total / count))} · ${vsYesterday}` : `Καμία πώληση ακόμα σήμερα · ${vsYesterday}`, icon: ReceiptText },
    { label: "Μετρητά", value: euro(by("CASH")), hint: "Πρέπει να βρίσκονται στο συρτάρι", icon: Banknote },
    { label: "Κάρτες", value: euro(by("CARD")), hint: "Θα πιστωθούν από τη Viva", icon: CreditCard },
  ];

  return (
    <Page section="Επισκόπηση" title="Πίνακας ελέγχου" description={org.name} actions={<Link href="/pos" className={btn("gold")}>Άνοιγμα ταμείου</Link>}>
      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">{label}<Icon className="size-5 text-gold" /></div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg">Πωλήσεις ανά ώρα, σήμερα</h2>
          {best ? <p className="text-sm text-muted-foreground">Καλύτερη ώρα <span className="font-semibold text-gold-ink tabular-nums">{String(best.h).padStart(2, "0")}:00 · {euro(best.total)}</span></p> : null}
        </div>
        {hours.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Το γράφημα γεμίζει με την πρώτη απόδειξη της ημέρας</p>
        ) : (
          <div className="mt-6 flex h-52 items-end gap-1.5 border-b border-border sm:gap-3" role="img" aria-label={`Πωλήσεις ανά ώρα. Καλύτερη ώρα ${best?.h}:00 με ${euro(peak)}`}>
            {hours.map((h) => (
              <div key={h.h} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className={`text-xs tabular-nums max-sm:hidden ${h === best ? "font-semibold text-gold-ink" : "text-muted-foreground"}`}>{euro(h.total)}</span>
                {/* μία έμφαση ανά γράφημα: η καλύτερη ώρα */}
                <div className={`w-full max-w-12 rounded-t-sm ${h === best ? "bg-gold" : "bg-chart-1/85"}`} style={{ height: `${Math.max(3, (h.total / peak) * 80)}%` }} />
              </div>
            ))}
          </div>
        )}
        {hours.length ? (
          <div className="mt-1.5 flex gap-1.5 sm:gap-3" aria-hidden>
            {hours.map((h) => <span key={h.h} className="min-w-0 flex-1 text-center text-xs text-muted-foreground tabular-nums">{String(h.h).padStart(2, "0")}</span>)}
          </div>
        ) : null}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <h2 className="border-b border-border px-5 py-4 text-lg">Θέλουν προσοχή{issues.length ? <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{issues.length}</span> : null}</h2>
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-muted-foreground"><CircleCheck className="size-5 text-success" /> Όλα εντάξει: αποδείξεις, συσκευές και συνδρομή</p>
          ) : (
            <ul className="divide-y divide-border">
              {issues.map((i) => (
                <li key={i.text}>
                  <Link href={i.href} className="flex min-h-12 items-center gap-3 px-5 py-2 hover:bg-secondary">
                    <span aria-hidden className={`size-2 shrink-0 rounded-full ${i.tone === "danger" ? "bg-destructive" : "bg-gold"}`} />
                    <span className="min-w-0 flex-1 font-medium">{i.text}</span>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">{i.action} <ArrowRight className="size-4" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-lg">Γρήγορες ενέργειες</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {shortcuts.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="flex min-h-12 items-center gap-2 rounded-lg border border-border px-3 font-medium hover:bg-secondary">
                <Icon className="size-4 text-muted-foreground" /> {label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
