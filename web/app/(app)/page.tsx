import { Banknote, CreditCard, ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { currentOrg } from "@/lib/auth";

type Hour = { h: number; total: number };
type Method = { method: "CASH" | "CARD"; total: number; n: number };

export default async function DashboardPage() {
  const { org } = await currentOrg("dashboard.view");
  // «Σήμερα» = ημέρα Αθήνας (το issuedAt αποθηκεύεται σε UTC)
  const today = `("issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Athens')`;
  const [hours, methods, unsent, [{ total: yesterday }]] = await Promise.all([
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
  ]);
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
      {unsent > 0 ? (
        <Link href="/receipts" className="mb-4 flex items-center gap-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium">
          <TriangleAlert className="size-5 shrink-0 text-gold" />
          {unsent} {unsent === 1 ? "απόδειξη δεν έχει" : "αποδείξεις δεν έχουν"} διαβιβαστεί στην ΑΑΔΕ. Δες ποιες →
        </Link>
      ) : null}
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
    </Page>
  );
}
