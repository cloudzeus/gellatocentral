import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Layers3, Plus, Save } from "lucide-react";
import { OfflineCountMeasurements, OfflineCountQueue, OnlineOnlyFinalize } from "@/components/offline-counts";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity, formatStockValue, stockDisplayUnit, stockUnitCostHundredths, stockValueHundredths } from "@/lib/stock-view";
import { addCountLine, addCountLot, finalizeCount, saveCountMeasurements } from "../actions";
import { StatusBadge } from "@/components/status-badge";

const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";
const th = "px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground";
const td = "border-t border-border/70 px-4 py-3 align-top";
const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Η καρτέλα παραμένει Server Component· οι φόρμες συνδέονται με id χωρίς nested forms ή client state.
export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const ctx = await requireStockContext("counts.read");
  const warehouses = await db.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } });
  const count = await db.stockCount.findFirst({
    where: { id, orgId: ctx.orgId, warehouseId: { in: warehouses.map((warehouse) => warehouse.id) } },
    include: {
      warehouse: { select: { name: true, active: true } },
      store: { select: { name: true, active: true } },
      lines: {
        include: {
          genericItem: { include: { baseUnit: true } },
          lot: { select: { batchNumber: true, expiresAt: true } },
          movement: { select: { id: true } },
        },
        orderBy: [{ genericItem: { name: "asc" } }, { lotId: "asc" }],
      },
    },
  });
  if (!count) notFound();

  const draft = count.status === "DRAFT";
  const activeScope = count.warehouse.active && (count.store?.active ?? true);
  const canEdit = draft && activeScope && ctx.can("counts.edit");
  const canFinalize = draft && activeScope && ctx.can("counts.finalize");
  const [generics, lots] = canEdit ? await Promise.all([
    db.genericItem.findMany({
      where: { orgId: ctx.orgId, trackStock: true, active: true },
      include: { baseUnit: true },
      orderBy: { name: "asc" },
    }),
    db.stockLot.findMany({
      where: { orgId: ctx.orgId, warehouseId: count.warehouseId },
      include: { genericItem: { select: { name: true } } },
      orderBy: [{ genericItem: { name: "asc" } }, { batchNumber: "asc" }],
    }),
  ]) : [[], []];
  const present = new Set(count.lines.map((line) => `${line.genericItemId}|${line.lotId ?? ""}`));
  const existingOptions = [
    ...generics.map((generic) => ({ value: `${generic.id}|`, label: `${generic.name} · χωρίς παρτίδα` })),
    ...lots.map((lot) => ({ value: `${lot.genericItemId}|${lot.id}`, label: `${lot.genericItem.name} · παρτίδα ${lot.batchNumber ?? "χωρίς αριθμό"}` })),
  ].filter((option) => !present.has(option.value));
  const error = param(q.error);

  return (
    <Page
      section="Αποθήκη & αγορές"
      title={`Απογραφή ${day.format(count.countedOn)}`}
      description={`${count.store ? `Κατάστημα: ${count.store.name} · ` : "Εργαστήριο / αποθήκη · "}${count.warehouse.name} · ${draft ? "προσχέδιο μετρήσεων" : "οριστικοποιημένο ιστορικό"}`}
      actions={<Link href="/counts" className={btn("outline", "sm")}><ArrowLeft /> Όλες οι απογραφές</Link>}
    >
      <div className="grid max-w-[100rem] gap-5">
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η ενέργεια δεν ολοκληρώθηκε: {error.slice(0, 250)}</p> : null}

        <Card className="px-5 py-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Στοιχεία απογραφής</h2><StatusBadge kind="stockCount" value={count.status} /></div>
              {count.note ? <p className="mt-2 text-sm">{count.note}</p> : null}
            </div>
            <dl className="grid w-full gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:w-auto lg:min-w-[34rem]">
              <div><dt className="text-xs text-muted-foreground">Snapshot αποθέματος</dt><dd className="font-medium">{dateTime.format(count.snapshotAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Δημιουργήθηκε από</dt><dd className="font-medium">{count.createdByName}</dd></div>
              {count.finalizedAt ? <div><dt className="text-xs text-muted-foreground">Οριστικοποίηση</dt><dd className="font-medium">{dateTime.format(count.finalizedAt)}</dd></div> : null}
              {count.finalizedByName ? <div><dt className="text-xs text-muted-foreground">Οριστικοποιήθηκε από</dt><dd className="font-medium">{count.finalizedByName}</dd></div> : null}
            </dl>
          </div>
          {draft ? <p className="mt-4 rounded-lg bg-secondary/45 px-3 py-2 text-xs text-muted-foreground">Οι ποσότητες καταχωρίζονται στη βασική μονάδα κάθε είδους (mg, ml ή τεμάχια). Αποθήκευσε τις μετρήσεις πριν από την οριστικοποίηση. Αν καταγραφεί νέα κίνηση μετά το snapshot, η οριστικοποίηση απορρίπτεται αντί να γίνει rebase.</p> : null}
          {!count.warehouse.active && draft ? <p className="mt-3 text-sm font-medium text-destructive">Η αποθήκη είναι ανενεργή· η απογραφή παραμένει read-only.</p> : null}
          {count.store && !count.store.active && draft ? <p className="mt-3 text-sm font-medium text-destructive">Το κατάστημα είναι ανενεργό· η απογραφή παραμένει read-only.</p> : null}
        </Card>

        {count.store ? <OfflineCountQueue identity={{ orgId: ctx.orgId, userId: ctx.userId }} /> : null}
        {canEdit ? <form id="count-measurements" action={saveCountMeasurements.bind(null, count.id)} /> : null}
        {canEdit && count.store ? <OfflineCountMeasurements identity={{ orgId: ctx.orgId, userId: ctx.userId }} formId="count-measurements" countId={count.id} expectedUpdatedAt={count.updatedAt.toISOString()} /> : null}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Μετρήσεις ειδών και παρτίδων</h2><p className="text-sm text-muted-foreground">Το αναμενόμενο είναι το παγωμένο snapshot· η διαφορά είναι πραγματική μείον αναμενόμενη ποσότητα.</p></div>
            {canEdit && count.lines.length ? <Submit form="count-measurements" className={btn("outline", "sm")} pendingText="Αποθήκευση…"><Save /> Αποθήκευση μετρήσεων</Submit> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[82rem] border-collapse text-sm">
              <thead className="bg-secondary/35"><tr><th className={th} scope="col">Είδος</th><th className={th} scope="col">Παρτίδα / λήξη</th><th className={`${th} text-right`} scope="col">Αναμενόμενο</th><th className={`${th} text-right`} scope="col">Πραγματικό</th><th className={`${th} text-right`} scope="col">Διαφορά</th><th className={`${th} text-right`} scope="col">Κόστος snapshot</th><th className={`${th} text-right`} scope="col">Αξία διαφοράς</th><th className={th} scope="col">Αιτιολογία διαφοράς</th></tr></thead>
              <tbody>
                {count.lines.map((line) => (
                  <tr key={line.id}>
                    <td className={`${td} font-semibold`}>
                      {canEdit ? <input form="count-measurements" type="hidden" name="lineIds" value={line.id} /> : null}
                      {line.genericItem.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">Βασική μονάδα: {line.genericItem.baseUnit.code}</span>
                    </td>
                    <td className={td}>{line.lot ? <><span className="font-medium">{line.lot.batchNumber ?? "Χωρίς αριθμό"}</span><span className="mt-1 block whitespace-nowrap text-xs text-muted-foreground">{line.lot.expiresAt ? `Λήξη: ${day.format(line.lot.expiresAt)}` : "Χωρίς λήξη"}</span></> : "Χωρίς παρτίδα"}</td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{formatStockQuantity(line.expectedQty, line.genericItem.baseUnit.dimension)}</td>
                    <td className={`${td} text-right`}>
                      {canEdit ? <input form="count-measurements" aria-label={`Πραγματική ποσότητα: ${line.genericItem.name}`} name={`actual_${line.id}`} type="number" inputMode="numeric" min={0} max={2_147_483_647} step={1} defaultValue={line.actualQty ?? ""} placeholder={line.genericItem.baseUnit.code} className={`${field} ml-auto w-32 text-right tabular-nums`} /> : <span className="whitespace-nowrap tabular-nums">{line.actualQty === null ? "—" : formatStockQuantity(line.actualQty, line.genericItem.baseUnit.dimension)}</span>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap font-medium tabular-nums ${line.differenceQty ? line.differenceQty > 0 ? "text-success" : "text-destructive" : ""}`}>{line.differenceQty === null ? "—" : formatStockQuantity(line.differenceQty, line.genericItem.baseUnit.dimension)}</td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{line.unitCostHundredths > 0 ? <>{formatStockValue(stockUnitCostHundredths(line.unitCostHundredths, stockDisplayUnit(line.genericItem.baseUnit).toBase, line.genericItem.baseUnit.dimension))} <span className="text-xs text-muted-foreground">/ {stockDisplayUnit(line.genericItem.baseUnit).code}</span></> : "—"}</td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{line.unitCostHundredths > 0 && line.differenceQty !== null ? formatStockValue(stockValueHundredths(line.differenceQty, line.unitCostHundredths, line.genericItem.baseUnit.dimension)) : "—"}</td>
                    <td className={td}>
                      {canEdit ? <textarea form="count-measurements" aria-label={`Αιτιολογία: ${line.genericItem.name}`} name={`reason_${line.id}`} rows={2} maxLength={200} defaultValue={line.reason ?? ""} placeholder="Υποχρεωτική μόνο αν υπάρχει διαφορά" className="w-64 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" /> : line.reason ?? "—"}
                      {line.movement ? <span className="mt-1 block text-xs text-muted-foreground">Καταγράφηκε διόρθωση αποθέματος</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!count.lines.length ? <p className="px-5 py-6 text-sm text-muted-foreground">Το snapshot δεν είχε μη μηδενικό απόθεμα. Πρόσθεσε ρητά είδος ή φυσική παρτίδα που βρέθηκε στη μέτρηση.</p> : null}
          {canEdit && count.lines.length ? <div className="flex justify-end border-t border-border/70 px-5 py-4"><Submit form="count-measurements" className={btn("default")} pendingText="Αποθήκευση…"><Save /> Αποθήκευση μετρήσεων</Submit></div> : null}
        </Card>

        {canEdit ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="border-b border-border/70 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><Plus className="size-5" /> Είδος ή υπάρχουσα παρτίδα</h2><p className="mt-1 text-sm text-muted-foreground">Για ποσότητα που δεν υπήρχε στο αρχικό snapshot. Η γραμμή ξεκινά με αναμενόμενο μηδέν.</p></div>
              {existingOptions.length ? <form action={addCountLine.bind(null, count.id)} className="grid gap-4 px-5 py-5">
                <label className="space-y-1 text-sm font-medium">Είδος και παρτίδα
                  <select name="stockKey" required defaultValue="" className={field}><option value="" disabled>Επίλεξε γραμμή</option>{existingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                </label>
                <Submit className={`${btn("outline")} justify-self-end`} pendingText="Προσθήκη…">Προσθήκη γραμμής</Submit>
              </form> : <p className="px-5 py-5 text-sm text-muted-foreground">Όλα τα διαθέσιμα είδη και οι παρτίδες της αποθήκης υπάρχουν ήδη στην απογραφή.</p>}
            </Card>

            <Card>
              <div className="border-b border-border/70 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><Layers3 className="size-5" /> Νέα φυσική παρτίδα</h2><p className="mt-1 text-sm text-muted-foreground">Καταχώρισε τον πραγματικό αριθμό και τη λήξη που αναγράφονται στη συσκευασία· δεν παράγεται αυτόματο batch.</p></div>
              {generics.length ? <form action={addCountLot.bind(null, count.id)} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium sm:col-span-2">Είδος
                  <select name="genericItemId" required defaultValue="" className={field}><option value="" disabled>Επίλεξε είδος</option>{generics.map((generic) => <option key={generic.id} value={generic.id}>{generic.name}</option>)}</select>
                </label>
                <label className="space-y-1 text-sm font-medium">Πραγματικός αριθμός παρτίδας<input name="batchNumber" required minLength={1} maxLength={80} className={field} /></label>
                <label className="space-y-1 text-sm font-medium">Λήξη (προαιρετική)<input name="expiresAt" type="date" className={field} /></label>
                <div className="sm:col-span-2 sm:justify-self-end"><Submit className={btn("outline")} pendingText="Προσθήκη…">Δημιουργία παρτίδας & γραμμής</Submit></div>
              </form> : <p className="px-5 py-5 text-sm text-muted-foreground">Δεν υπάρχει ενεργό είδος με παρακολούθηση αποθέματος.</p>}
            </Card>
          </div>
        ) : null}

        {draft ? <Card className="px-5 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Οριστικοποίηση</h2><p className="mt-1 text-sm text-muted-foreground">Απαιτούνται πραγματική ποσότητα σε κάθε γραμμή και αιτιολογία 3–200 χαρακτήρων σε κάθε διαφορά. Επιτρέπεται μία οριστική απογραφή ανά αποθήκη και ημερομηνία.</p></div>
            {canFinalize && count.lines.length ? <form id="count-finalize" action={finalizeCount.bind(null, count.id)}>{count.store ? <OnlineOnlyFinalize formId="count-finalize" className={btn("default")} identity={{ orgId: ctx.orgId, userId: ctx.userId }} countId={count.id}><CheckCircle2 /> Οριστικοποίηση απογραφής</OnlineOnlyFinalize> : <Submit className={btn("default")} pendingText="Οριστικοποίηση…"><CheckCircle2 /> Οριστικοποίηση απογραφής</Submit>}</form> : null}
          </div>
          {!ctx.can("counts.finalize") ? <p className="mt-3 text-sm text-muted-foreground">Δεν έχεις δικαίωμα οριστικοποίησης.</p> : null}
        </Card> : null}
      </div>
    </Page>
  );
}
