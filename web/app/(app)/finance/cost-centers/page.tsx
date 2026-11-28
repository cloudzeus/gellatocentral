import { BarChart3, Building2, Equal, FlaskConical, Grid2x2, Info, Pencil, Percent, Plus, ShoppingBag, Store, Tag, Truck, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { RoutedModal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { listCostCenters, previewAllocation } from "@/lib/cost-centers-db";
import { BASES, type Basis, HQ_CODE, type Share, STORES_CODE } from "@/lib/cost-centers-rules";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { saveCenterAction, saveRuleAction } from "./actions";

const BASIS: Record<Basis, { label: string; hint: string; icon: LucideIcon }> = {
  FIXED: { label: "Σταθερά ποσοστά", hint: "Ορίζεις εσύ, π.χ. 50/30/20", icon: Percent },
  REVENUE: { label: "Με τον τζίρο", hint: "Όποιος πουλά περισσότερα, πληρώνει περισσότερα", icon: BarChart3 },
  AREA: { label: "Με τα τ.μ.", hint: "Ανάλογα με το μέγεθος", icon: Grid2x2 },
  ORDERS: { label: "Με τις παραγγελίες", hint: "Delivery που παραδόθηκαν", icon: ShoppingBag },
  EQUAL: { label: "Ισόποσα", hint: "Το ίδιο σε όλα", icon: Equal },
};
const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  STORE: { label: "Κατάστημα", icon: Store }, PRODUCTION: { label: "Παραγωγή", icon: FlaskConical }, HQ: { label: "Διοίκηση", icon: Building2 },
  DELIVERY: { label: "Διανομή", icon: Truck }, OTHER: { label: "Άλλο", icon: Tag },
};
const SOURCE: Record<string, string> = { SEED: "προεπιλογή", USER: "χρήστη", ACCOUNTANT: "λογιστή" };
const date = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (w: number) => (w / 100).toLocaleString("el-GR", { maximumFractionDigits: 2 });

export default async function CostCentersPage({ searchParams }: PageProps<"/finance/cost-centers">) {
  const ctx = await requireStockContext("finance.read");
  const q = await searchParams;
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const canEdit = ctx.can("finance.edit");

  // shortcut: μήνας σε όρια UTC, όχι Αθήνας· οι 2-3 ώρες στις άκρες δεν αλλάζουν ουσιαστικά τα μερίδια τζίρου
  const thisMonth = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Europe/Athens" }).format(new Date()).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(str("m")) ? str("m") : thisMonth;
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const amountEuro = Number(str("a").replace(",", ".")) > 0 ? Number(str("a").replace(",", ".")) : 1000;
  const amountCents = Math.round(amountEuro * 100);

  const [centers, spent] = await Promise.all([
    listCostCenters(ctx.orgId),
    db.expense.groupBy({ by: ["costCenterId"], where: { orgId: ctx.orgId, occurredAt: { gte: from, lt: to } }, _sum: { netCents: true } }),
  ]);
  const spentOf = new Map(spent.map((s) => [s.costCenterId, s._sum.netCents ?? 0]));
  const shared = centers.filter((c) => !c.storeId && c.code !== STORES_CODE);
  const stores = centers.filter((c) => c.storeId && c.active);
  const selected = shared.find((c) => c.id === str("c")) ?? shared.find((c) => c.code === HQ_CODE) ?? shared[0];
  const today = new Date(`${iso(new Date())}T00:00:00Z`);
  const current = selected?.rules.find((r) => r.validFrom <= today && (!r.validTo || r.validTo >= today)) ?? selected?.rules[0];
  const basis = (BASES as readonly string[]).includes(str("basis")) ? (str("basis") as Basis) : ((current?.basis as Basis) ?? "REVENUE");
  const currentShares = new Map(((current?.shares ?? []) as Share[]).map((s) => [s.costCenterId, s.weight]));
  const nextMonth = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));

  let preview: Awaited<ReturnType<typeof previewAllocation>> | null = null;
  let previewError: string | null = null;
  if (selected) {
    try { preview = await previewAllocation(ctx.orgId, selected.id, amountCents, from, to); }
    catch (e) { previewError = e instanceof Error ? e.message : "Η κατανομή δεν υπολογίστηκε"; }
  }
  const previewRule = selected?.rules.find((r) => r.validFrom <= from && (!r.validTo || r.validTo >= from));
  const previewShares = new Map(((previewRule?.shares ?? []) as Share[]).map((s) => [s.costCenterId, s.weight]));
  const measureText = (id: string, measure: number | null) => {
    if (!preview) return "";
    if (preview.basis === "REVENUE") return `τζίρος ${euro(measure ?? 0)}`;
    if (preview.basis === "ORDERS") return `${(measure ?? 0).toLocaleString("el-GR")} παραγγελίες`;
    if (preview.basis === "FIXED") return `${pct(previewShares.get(id) ?? 0)}%`;
    if (preview.basis === "AREA") return `${pct(previewShares.get(id) ?? 0)} τ.μ.`;
    return "ίσο μερίδιο";
  };
  const maxCents = Math.max(1, ...(preview?.rows.map((r) => r.cents) ?? []));
  const top = preview?.rows.reduce((a, b) => (b.cents > a.cents ? b : a), preview.rows[0]);
  const keep = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(selected ? { c: selected.id } : {}), m: month, a: String(amountEuro), ...extra })}`;

  const editing = str("edit") ? centers.find((c) => c.id === str("edit")) : undefined;
  const showForm = canEdit && (str("new") === "1" || !!editing);
  const error = str("error") || null;

  return (
    <Page section="Οικονομικά" title="Κέντρα κόστους"
      description="Σε ποιο κατάστημα ή τμήμα «ανήκει» κάθε δαπάνη. Τα κοινά έξοδα (έδρα, εργαστήριο, διανομή) μοιράζονται στα καταστήματα με έναν κανόνα. Είναι διοικητική εικόνα: δεν αλλάζει τα παραστατικά, το myDATA ή ό,τι στέλνεται στον λογιστή"
      actions={canEdit ? <Link href={keep({ new: "1" })} scroll={false} className={btn("default")}><Plus aria-hidden />Νέο κέντρο</Link> : undefined}>
      {error && !showForm ? <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p> : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <div className="flex items-baseline justify-between gap-3 border-b px-5 py-4"><h2 className="font-semibold">Όλα τα κέντρα</h2><span className="text-xs text-muted-foreground first-letter:uppercase">{monthName.format(from)} · καθαρά, χωρίς ΦΠΑ</span></div>
          <ul className="grid gap-0.5 p-2">
            {centers.map((c) => {
              const Icon = KIND[c.kind]?.icon ?? Tag;
              const rule = c.rules.find((r) => r.validFrom <= today && (!r.validTo || r.validTo >= today));
              const money = spentOf.get(c.id) ?? 0;
              const body = (
                <>
                  <span className="w-8 shrink-0 font-mono sm:w-10 text-xs text-muted-foreground">{c.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{c.name}</span></span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.storeId ? <Badge>τελικό</Badge> : rule ? <Badge tone="success">{BASIS[rule.basis as Basis]?.label}</Badge> : c.code === STORES_CODE ? null : <Badge tone="warning" icon={TriangleAlert}>χωρίς κανόνα</Badge>}
                      {c.active ? null : <Badge tone="warning">ανενεργό</Badge>}
                      {c.code === STORES_CODE ? null : <span className="text-xs text-muted-foreground tabular-nums sm:hidden">{money ? `${euro(money)} μήνα` : "καμία δαπάνη"}</span>}
                    </span>
                  </span>
                  {c.code === STORES_CODE ? null : <span className="hidden shrink-0 text-right tabular-nums sm:block">{money ? <><b className="block font-semibold">{euro(money)}</b><small className="text-xs text-muted-foreground">δαπάνες μήνα</small></> : <small className="text-xs text-muted-foreground">καμία δαπάνη</small>}</span>}
                </>
              );
              const row = "flex min-h-14 min-w-0 items-center gap-3 rounded-lg px-3 py-2";
              return (
                <li key={c.id} className={cn("flex items-center gap-1", c.parentId && "pl-6")}>
                  {c.storeId || c.code === STORES_CODE
                    ? <div className={cn(row, "flex-1")}>{body}</div>
                    : <Link href={`?${new URLSearchParams({ c: c.id, m: month, a: String(amountEuro) })}`} scroll={false} aria-current={c.id === selected?.id ? "true" : undefined}
                        className={cn(row, "flex-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", c.id === selected?.id && "bg-primary/8 ring-1 ring-primary/30")}>{body}</Link>}
                  {canEdit ? <Link href={keep({ edit: c.id })} scroll={false} className={btn("ghost", "sm")} aria-label={`Αλλαγή κέντρου ${c.code}`} title="Αλλαγή"><Pencil aria-hidden /></Link> : null}
                </li>
              );
            })}
          </ul>
        </Card>

        {selected ? (
          <div className="grid gap-4">
            <Card>
              <div className="border-b px-5 py-4">
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Κωδικός <b className="font-mono font-medium text-foreground">{selected.code}</b></span>
                  <span>Λογαριασμός λογιστή <b className="font-mono font-medium text-foreground">{selected.accountCode || "—"}</b></span>
                  <span>Από <b className="font-medium text-foreground">{SOURCE[selected.source] ?? selected.source}</b></span>
                </p>
              </div>
              {canEdit ? (
                <form action={saveRuleAction} className="group/rule grid gap-4 p-5">
                  <input type="hidden" name="sourceId" value={selected.id} />
                  <fieldset className="grid gap-2">
                    <legend className="mb-2 text-sm text-muted-foreground">Πώς μοιράζονται τα έξοδα αυτού του κέντρου στα καταστήματα</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {BASES.map((b) => {
                        const { label, hint, icon: Icon } = BASIS[b];
                        return (
                          <label key={b} className="flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border p-3 hover:bg-secondary has-[:checked]:border-primary has-[:checked]:bg-primary/8 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
                            <input type="radio" name="basis" value={b} defaultChecked={b === basis} className="sr-only" />
                            <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />{label}</span>
                            <span className="hidden text-xs text-muted-foreground sm:block">{hint}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  {(["FIXED", "AREA"] as const).map((b) => (
                    <div key={b} className={cn("hidden gap-2", b === "FIXED" ? "group-has-[[value=FIXED]:checked]/rule:grid" : "group-has-[[value=AREA]:checked]/rule:grid")}>
                      <p className="text-sm text-muted-foreground">{b === "FIXED" ? "Ποσοστό ανά κατάστημα. Πρέπει να αθροίζουν ακριβώς 100%" : "Τετραγωνικά ανά κατάστημα"}. Κενό = το κατάστημα δεν παίρνει μερίδιο</p>
                      {stores.map((s) => (
                        <label key={s.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
                          <span><span className="font-medium">{s.name}</span> <span className="font-mono text-xs text-muted-foreground">{s.code}</span></span>
                          <span className="flex items-center gap-2">
                            <input type="hidden" name={`${b}Id`} value={s.id} />
                            <input name={`${b}Value`} inputMode="decimal" defaultValue={current?.basis === b && currentShares.has(s.id) ? pct(currentShares.get(s.id)!) : ""}
                              aria-label={`${s.name} ${b === "FIXED" ? "ποσοστό" : "τ.μ."}`} className="h-10 w-24 rounded-md border bg-background px-3 text-right tabular-nums" />
                            <span className="w-8 text-sm text-muted-foreground">{b === "FIXED" ? "%" : "τ.μ."}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                  <p className="hidden text-sm text-muted-foreground group-has-[[value=REVENUE]:checked]/rule:block">Δεν χρειάζεται να συμπληρώσεις κάτι: τα μερίδια βγαίνουν κάθε μήνα από τις πωλήσεις των ταμείων</p>
                  <p className="hidden text-sm text-muted-foreground group-has-[[value=ORDERS]:checked]/rule:block">Δεν χρειάζεται να συμπληρώσεις κάτι: τα μερίδια βγαίνουν κάθε μήνα από τις παραγγελίες delivery που παραδόθηκαν</p>
                  <p className="hidden text-sm text-muted-foreground group-has-[[value=EQUAL]:checked]/rule:block">Δεν χρειάζεται να συμπληρώσεις κάτι: κάθε ενεργό κατάστημα παίρνει το ίδιο ποσό</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Ισχύει από" name="validFrom" type="date" required defaultValue={nextMonth} hint="Ο κανόνας που ισχύει τώρα κλείνει την προηγούμενη μέρα" />
                    <Field label="Έως" name="validTo" type="date" hint="Κενό = χωρίς λήξη" />
                    <Submit className={btn("default", "default", "justify-self-end sm:col-span-2")} pendingText="Αποθήκευση…">Αποθήκευση κανόνα</Submit>
                  </div>
                </form>
              ) : (
                <p className="p-5 text-sm">{current ? <>Μοιράζεται <b>{BASIS[current.basis as Basis]?.label.toLowerCase()}</b> από {date.format(current.validFrom)}</> : "Δεν έχει κανόνα ακόμα"}</p>
              )}
            </Card>

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4"><h2 className="font-semibold">Πώς μοιράζεται ένα ποσό</h2><span className="text-xs text-muted-foreground">με τα πραγματικά στοιχεία του μήνα</span></div>
              <div className="grid gap-4 p-5">
                <form className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="c" value={selected.id} />
                  <div className="w-40"><Field label="Ποσό σε €" name="a" inputMode="decimal" defaultValue={String(amountEuro).replace(".", ",")} /></div>
                  <div className="w-48"><Field label="Μήνας" name="m" type="month" defaultValue={month} /></div>
                  <button className={btn("outline", "default", "mb-0.5")}>Υπολογισμός</button>
                </form>
                {previewError ? <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-warning-ink"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{previewError}. Διάλεξε άλλο μήνα ή βάλε κανόνα που ξεκινά νωρίτερα</p> : null}
                {preview ? (
                  <>
                    {preview.warning ? <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-warning-ink"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{preview.warning}</p> : null}
                    <ul className="grid gap-3" aria-label={`Κατανομή ${euro(amountCents)} ανά κατάστημα, ${BASIS[preview.basis].label.toLowerCase()}`}>
                      {preview.rows.map((r) => (
                        <li key={r.id} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3">
                          <span className="min-w-0"><b className="block truncate font-medium">{r.name}</b><small className="block truncate text-xs text-muted-foreground tabular-nums">{measureText(r.id, r.measure)}</small></span>
                          <span className="h-2.5 rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${(r.cents / maxCents) * 100}%` }} /></span>
                          <span className="text-right tabular-nums"><b className="block font-semibold">{euro(r.cents)}</b><small className="text-xs text-muted-foreground">{Math.round((r.cents / amountCents) * 100)}% του ποσού</small></span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-between border-t pt-3 text-sm"><span className="text-muted-foreground">Σύνολο στα καταστήματα</span><b className="tabular-nums">{euro(preview.rows.reduce((t, r) => t + r.cents, 0))}</b></div>
                    {top ? <p className="flex items-start gap-2 rounded-lg bg-secondary p-3 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span>Από κάθε {euro(amountCents)} του κέντρου «{selected.name}», το μεγαλύτερο μέρος ({euro(top.cents)}) πάει στο <b>{top.name}</b>. Το ποσό μπαίνει στο αποτέλεσμα του καταστήματος. Τα λεπτά δεν χάνονται: το σύνολο είναι πάντα ακριβώς το ποσό</span></p> : null}
                  </>
                ) : null}
              </div>
            </Card>

            <Card>
              <div className="border-b px-5 py-4"><h2 className="font-semibold">Ιστορικό κανόνων</h2></div>
              {selected.rules.length ? (
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">Περίοδος</th><th className="px-2 py-2 font-medium">Βάση</th><th className="px-5 py-2 font-medium">Από</th></tr></thead>
                  <tbody>
                    {selected.rules.map((r) => {
                      const shares = (r.shares as Share[]);
                      const detail = r.basis === "FIXED" && shares.length ? ` ${shares.map((s) => pct(s.weight)).join("/")}` : "";
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-5 py-2.5">{date.format(r.validFrom)} – {r.validTo ? date.format(r.validTo) : "χωρίς λήξη"}</td>
                          <td className="px-2 py-2.5">{BASIS[r.basis as Basis]?.label}{detail}</td>
                          <td className="px-5 py-2.5">{r.createdByName ?? <span className="text-muted-foreground">προεπιλογή</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="p-5 text-sm text-muted-foreground">Κανένας κανόνας ακόμα. Χωρίς κανόνα, τα έξοδα του κέντρου δεν μοιράζονται στα καταστήματα</p>}
            </Card>
          </div>
        ) : null}
      </div>

      {showForm ? (
        <RoutedModal title={editing ? `Κέντρο ${editing.code}` : "Νέο κέντρο"} description="Ο κωδικός και ο λογαριασμός βοηθούν τον λογιστή να το αναγνωρίζει" closeHref={keep({})}>
          <form action={saveCenterAction} className="grid gap-4 sm:grid-cols-2">
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive sm:col-span-2">{error}</p> : null}
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <Field label="Κωδικός" name="code" required maxLength={25} defaultValue={editing?.code ?? ""} hint="Π.χ. 60 ή 20.1" />
            <Field label="Όνομα" name="name" required maxLength={120} defaultValue={editing?.name ?? ""} />
            <Select label="Είδος" name="kind" defaultValue={editing?.kind ?? "OTHER"} options={Object.entries(KIND).filter(([k]) => k !== "STORE" || editing?.storeId).map(([k, v]) => [k, v.label])} disabled={!!editing?.storeId} />
            {editing?.storeId ? <input type="hidden" name="kind" value="STORE" /> : null}
            <Select label="Ανήκει κάτω από" name="parentId" defaultValue={editing?.parentId ?? ""} options={[["", "Κανένα (πρώτο επίπεδο)"], ...centers.filter((c) => c.id !== editing?.id && !c.storeId).map((c): [string, string] => [c.id, `${c.code} · ${c.name}`])]} />
            <Field label="Λογαριασμός λογιστή" name="accountCode" maxLength={40} defaultValue={editing?.accountCode ?? ""} hint="Προαιρετικό, π.χ. 64.98" />
            {editing ? (
              <label className="flex items-start gap-3 sm:pt-6"><input type="checkbox" name="active" value="true" defaultChecked={editing.active} className="mt-1 size-4 accent-primary" />
                <span><strong className="font-medium">Ενεργό</strong><span className="block text-xs text-muted-foreground">Ανενεργό κέντρο δεν προτείνεται στις νέες δαπάνες. Οι παλιές μένουν εκεί που ήταν</span></span></label>
            ) : null}
            <Submit className={btn("default", "default", "justify-self-end sm:col-span-2")} pendingText="Αποθήκευση…">Αποθήκευση</Submit>
          </form>
        </RoutedModal>
      ) : null}
    </Page>
  );
}
