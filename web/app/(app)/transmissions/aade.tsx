// Καρτέλα «Έλεγχος με την ΑΑΔΕ»: οι αποδείξεις μας ανά ημέρα απέναντι στα σύνολα της ΑΑΔΕ, και όσες δεν πήραν MARK.
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Β. Λογική: lib/mydata-receipts.ts.
import { BadgeCheck, CalendarX2, CircleAlert, RefreshCw } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Kpi } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { issuers, unmarkedReceipts } from "@/lib/mydata-receipts";
import { athensDay, checkDays, GRACE_NIGHTS } from "@/lib/mydata-receipts-match";
import { recheckReceipts } from "./actions";

const DAY = 86_400_000;
const time = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", dateStyle: "short", timeStyle: "short" });
const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const TYPE = (t: string) => (t === "11.4" ? "Πιστωτικά" : "Αποδείξεις");
const STATUS = { MATCH: ["success", "Συμφωνεί"], WAITING: ["neutral", "Περιμένουμε την ΑΑΔΕ"], DIFF: ["danger", "Δεν συμφωνεί"] } as const;
const COLOR = { MATCH: "var(--success)", WAITING: "var(--muted-foreground)", DIFF: "var(--destructive)" } as const;
type Status = keyof typeof STATUS;

/** Τι λέει μια ημέρα με λόγια: πόσες λιγότερες ή περισσότερες στην ΑΑΔΕ και με τι ποσό. */
function finding(r: { status: string; oursCount: number; oursCents: number; aadeCount: number | null; aadeCents: number | null }) {
  if (r.status === "MATCH") return null;
  if (r.aadeCount == null) return "Η ΑΑΔΕ δεν έχει ακόμα στοιχεία για την ημέρα";
  const n = r.oursCount - r.aadeCount, cents = r.oursCents - (r.aadeCents ?? 0);
  if (n > 0) return `${n} ${n === 1 ? "λιγότερη" : "λιγότερες"} στην ΑΑΔΕ · ${euro(Math.abs(cents))}. Όλες οι δικές μας έχουν MARK: στείλε την ημέρα στην υποστήριξη της Viva`;
  if (n < 0) return `${-n} ${n === -1 ? "περισσότερη" : "περισσότερες"} στην ΑΑΔΕ · ${euro(Math.abs(cents))}. Ίσως απόδειξη κομμένη έξω από το σύστημα`;
  return `Ίδιο πλήθος, άλλο σύνολο κατά ${euro(Math.abs(cents))}`;
}

export async function AadeView({ orgId, now = new Date() }: { orgId: string; now?: Date }) {
  const days = checkDays(now);
  const [rows, unmarked, list, last] = await Promise.all([
    db.mydataDayCheck.findMany({ where: { orgId, day: { gte: new Date(`${days[0]}T00:00:00Z`) } }, orderBy: [{ day: "desc" }, { invType: "asc" }] }),
    unmarkedReceipts(orgId, now),
    issuers(orgId),
    db.mydataDayCheck.findFirst({ where: { orgId }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } }),
  ]);
  const skipped = list.filter((i) => !i.userId || !i.subKey);
  const dayOf = (r: (typeof rows)[number]) => athensDay(r.day);
  // μία στήλη ανά ημέρα: το χειρότερο από όλους τους εκδότες και τύπους
  const perDay = days.map((day) => {
    const rs = rows.filter((r) => dayOf(r) === day);
    const status: Status | null = !rs.length ? null : rs.some((r) => r.status === "DIFF") ? "DIFF" : rs.some((r) => r.status === "WAITING") ? "WAITING" : "MATCH";
    return { day, status, count: rs.reduce((s, r) => s + r.oursCount, 0), gap: rs.reduce((s, r) => s + (r.aadeCount == null ? 0 : r.aadeCount - r.oursCount), 0) };
  });
  const max = Math.max(1, ...perDay.map((d) => d.count));
  const checked = perDay.filter((d) => d.status);
  const diffs = rows.filter((r) => r.status === "DIFF");
  const diffDays = new Set(diffs.map(dayOf)).size;
  const diffCents = diffs.reduce((s, r) => s + Math.abs(r.oursCents - (r.aadeCents ?? 0)), 0);
  const unmarkedCents = unmarked.reduce((s, r) => s + r.cents, 0);
  const order = { DIFF: 0, WAITING: 1, MATCH: 2 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status] || b.day.getTime() - a.day.getTime());

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Η ΑΑΔΕ δίνει για κάθε ημέρα πόσες αποδείξεις έχει και με τι σύνολο· τα συγκρίνουμε με τις δικές μας. {last ? <>Τελευταίος έλεγχος: {time.format(last.checkedAt)} · ως χθες {short(days.at(-1)!)}</> : "Δεν έχει γίνει ακόμα έλεγχος."}</span>
        <form action={recheckReceipts}><Submit pendingText="Έλεγχος…" className={btn("outline", "sm")}><RefreshCw /> Ξαναέλεγξε τώρα</Submit></form>
      </div>
      {skipped.length ? <p className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-warning-ink">Δεν ελέγχονται, γιατί δεν έχουν κλειδιά myDATA: {skipped.map((s) => `${s.name} (ΑΦΜ ${s.vat})`).join(", ")}. Τα ορίζει η πλατφόρμα στην καρτέλα της επιχείρησης.</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi icon={BadgeCheck} label="Ημέρες που συμφωνούν" tone={checked.length && !diffDays ? "success" : "neutral"}
          value={<>{checked.filter((d) => d.status === "MATCH").length} <span className="text-lg text-muted-foreground">από {checked.length}</span></>}
          hint={checked.length ? "Ίδιο πλήθος και ίδιο σύνολο με την ΑΑΔΕ" : "Πάτα «Ξαναέλεγξε τώρα» για τον πρώτο έλεγχο"} />
        <Kpi icon={CalendarX2} label="Ημέρες με διαφορά" tone={diffDays ? "danger" : "success"}
          value={<>{diffDays}{diffDays ? <span className="text-lg text-muted-foreground"> · {euro(diffCents)}</span> : null}</>}
          hint={diffDays ? "Δες τι βρήκαμε στον πίνακα παρακάτω" : `Μια ημέρα γίνεται κόκκινη μόνο αν διαφέρει ${GRACE_NIGHTS} βράδια`} />
        <Kpi icon={CircleAlert} label="Αποδείξεις χωρίς MARK" tone={unmarked.length ? "danger" : "success"}
          value={<>{unmarked.length}{unmarked.length ? <span className="text-lg text-muted-foreground"> · {euro(unmarkedCents)}</span> : null}</>}
          hint={unmarked.length ? "Η Viva τις ξαναστέλνει μόνη της· δες τη λίστα" : "Όλες οι αποδείξεις του μήνα έχουν MARK"} />
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Τελευταίες {days.length} ημέρες <span className="font-normal text-muted-foreground">· αποδείξεις με MARK ανά ημέρα</span></h2>
          <span className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {(Object.keys(STATUS) as Status[]).map((s) => <span key={s} className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: COLOR[s] }} />{STATUS[s][1]}</span>)}
          </span>
        </div>
        <div className="grid h-32 grid-cols-14 items-end gap-1 border-b pt-5 sm:gap-1.5" role="img" aria-label={perDay.map((d) => `${short(d.day)}: ${d.status ? STATUS[d.status][1] : "δεν ελέγχθηκε"}`).join(", ")}>
          {perDay.map((d) => (
            <span key={d.day} className="relative flex h-full flex-col justify-end" title={`${short(d.day)} · ${d.count} αποδείξεις${d.status ? ` · ${STATUS[d.status][1]}` : ""}`}>
              {d.status === "DIFF" && d.gap ? <b className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-destructive tabular-nums">{d.gap > 0 ? `+${d.gap}` : d.gap}</b> : null}
              <span className="rounded-t-sm" style={{ height: `${d.status ? Math.max(4, (d.count / max) * 100) : 4}%`, background: d.status ? COLOR[d.status] : "var(--muted)", opacity: d.status === "WAITING" ? 0.45 : 1 }} />
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-14 gap-1 text-center text-[length:var(--fs-11)] text-muted-foreground tabular-nums sm:gap-1.5">
          {perDay.map((d) => <span key={d.day}>{d.day.slice(8, 10)}</span>)}
        </div>
      </Card>

      <Card>
        <h2 className="px-4 pt-4 pb-2 text-sm font-semibold sm:px-5">Ανά ημέρα και εκδότη</h2>
        <DataTable
          id="aade-days"
          empty="Δεν έχει γίνει ακόμα έλεγχος με την ΑΑΔΕ"
          columns={[
            { key: "day", label: "Ημέρα", required: true },
            { key: "issuer", label: "Εκδότης", wrap: true },
            { key: "ours", label: "Δικές μας", numeric: true },
            { key: "aade", label: "Στην ΑΑΔΕ", numeric: true },
            { key: "finding", label: "Τι βρήκαμε", wrap: true },
          ]}
          rows={sorted.map((r) => {
            const f = finding(r);
            return {
              id: r.id,
              cells: {
                day: <span className="grid"><b className="tabular-nums">{short(dayOf(r))}</b><span className="text-xs text-muted-foreground">{TYPE(r.invType)} {r.invType}</span></span>,
                issuer: r.issuerName,
                ours: <span className="whitespace-nowrap tabular-nums">{r.oursCount} · {euro(r.oursCents)}</span>,
                aade: <span className="whitespace-nowrap tabular-nums">{r.aadeCount == null ? "—" : `${r.aadeCount} · ${euro(r.aadeCents ?? 0)}`}</span>,
                finding: <span className="grid justify-items-start gap-1"><Badge tone={STATUS[r.status as Status][0]}>{STATUS[r.status as Status][1]}</Badge>{f ? <span className="text-xs text-muted-foreground">{f}{r.status === "WAITING" ? ` · ξαναελέγχεται απόψε` : ""}</span> : null}</span>,
              },
            };
          })}
        />
      </Card>

      <Card>
        <h2 className="px-4 pt-4 pb-2 text-sm font-semibold sm:px-5">Αποδείξεις χωρίς MARK <span className="font-normal text-muted-foreground">· τελευταίος μήνας</span></h2>
        <DataTable
          id="aade-unmarked"
          empty="Όλες οι αποδείξεις του τελευταίου μήνα έχουν MARK"
          columns={[
            { key: "doc", label: "Απόδειξη", required: true },
            { key: "store", label: "Κατάστημα · ταμείο", wrap: true },
            { key: "amount", label: "Ποσό", numeric: true },
            { key: "finding", label: "Τι βρήκαμε", wrap: true },
          ]}
          rows={unmarked.map((r) => {
            const days = Math.floor((now.getTime() - r.at.getTime()) / DAY);
            return {
              id: r.id,
              cells: {
                doc: <span className="grid"><b>{r.label}</b><span className="text-xs text-muted-foreground tabular-nums">{time.format(r.at)} · {TYPE(r.docType)}</span></span>,
                store: [r.store, r.sale?.device.name].filter(Boolean).join(" · ") || "—",
                amount: <span className="whitespace-nowrap font-semibold">{euro(r.cents)}</span>,
                finding: <span className="grid justify-items-start gap-1">
                  <Badge tone={days >= 2 ? "danger" : "warning"}>{r.status === "PENDING" ? "Χωρίς απάντηση από τη Viva" : "Υπογράφηκε, χωρίς MARK ακόμα"}</Badge>
                  <span className="text-xs text-muted-foreground">{days >= 2 ? `${days} ημέρες χωρίς MARK: στείλε την απόδειξη στην υποστήριξη της Viva` : "Η Viva την ξαναστέλνει μόνη της στην ΑΑΔΕ"}</span>
                </span>,
              },
            };
          })}
        />
      </Card>
      <p className="text-xs text-muted-foreground">Ο έλεγχος τρέχει κάθε βράδυ για τις τελευταίες {days.length} ημέρες, για κάθε εκδότη με κλειδιά myDATA. Η ΑΑΔΕ δεν δίνει τις αποδείξεις της Viva μία-μία, γι’ αυτό συγκρίνουμε σύνολα. Η εφαρμογή μόνο διαβάζει από το myDATA.</p>
    </div>
  );
}
