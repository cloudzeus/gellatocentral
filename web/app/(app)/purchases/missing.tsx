// Καρτέλα «Λείπουν»: ό,τι δήλωσαν οι προμηθευτές στο myDATA για εμάς και δεν υπάρχει στις αγορές (lib/mydata-incoming.ts).
// Mockup: docs/analysis/mockups/mydata-reconcile.html, ενότητα Α.
import Link from "next/link";
import { BadgeCheck, CircleSlash, FileWarning, Link2, RefreshCw, Upload } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Kpi, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { OLD_DAYS, syncWindow, usualWarehouses } from "@/lib/mydata-incoming";
import { ignoreMissing, importMissing, linkMissing, recheckMissing } from "./actions";

const DAY = 86_400_000;
const CREDIT = /^5\./;
const TYPE_LABEL = (t: string | null) => (t && CREDIT.test(t) ? "Πιστωτικό" : t?.startsWith("13.") || t?.startsWith("14.") ? "Δαπάνη" : "Τιμολόγιο");
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(d) : "—");
const time = (d: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" }).format(d);

/** Πόσες ημέρες από την έκδοση· πάνω από OLD_DAYS είναι ήδη στις «Εργασίες». */
function Age({ issuedAt, now }: { issuedAt: Date | null; now: Date }) {
  if (!issuedAt) return null;
  const n = Math.max(0, Math.floor((now.getTime() - issuedAt.getTime()) / DAY));
  const tone = n > OLD_DAYS ? "bg-destructive/12 text-destructive" : n > 2 ? "bg-warning/20 text-warning-ink" : "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>{n === 1 ? "1 ημέρα" : `${n} ημέρες`}</span>;
}

export async function MissingView({ orgId, canAdd, canEdit, now = new Date() }: { orgId: string; canAdd: boolean; canEdit: boolean; now?: Date }) {
  const { from } = syncWindow(now);
  const [rows, all, warehouses, last] = await Promise.all([
    db.mydataIncoming.findMany({ where: { orgId, status: "MISSING" }, orderBy: [{ issuedAt: "asc" }, { firstSeenAt: "asc" }] }),
    db.mydataIncoming.findMany({ where: { orgId, issuedAt: { gte: from } }, select: { status: true, supplierVat: true, supplierName: true } }),
    db.warehouse.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // ο τελευταίος έλεγχος από τις «Εργασίες»: με μηδέν παραστατικά δεν υπάρχει γραμμή να κρατήσει την ώρα
    db.taskRun.findFirst({ where: { orgId, kind: "purchases.mydata-missing", status: { in: ["DONE", "PARTIAL"] } }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
  ]);
  const vats = [...new Set(rows.map((r) => r.supplierVat))];
  const [usual, candidates] = await Promise.all([
    usualWarehouses(orgId, vats),
    vats.length && canEdit ? db.purchaseDoc.findMany({
      where: { orgId, status: { not: "CANCELLED" }, mydataIncoming: null, mydataMark: null, supplier: { vatNumber: { in: vats } } },
      orderBy: { createdAt: "desc" }, take: 300, select: { id: true, number: true, issuedAt: true, supplier: { select: { vatNumber: true } } },
    }) : [],
  ]);

  const missingSum = rows.reduce((s, r) => s + (CREDIT.test(r.type ?? "") ? -1 : 1) * (r.grossCents ?? 0), 0);
  const found = all.filter((r) => r.status === "MATCHED" || r.status === "IMPORTED").length;
  const counted = all.filter((r) => r.status !== "IGNORED").length;
  const ignored = all.filter((r) => r.status === "IGNORED").length;
  const oldest = rows.find((r) => r.issuedAt);
  const oldestDays = oldest?.issuedAt ? Math.floor((now.getTime() - oldest.issuedAt.getTime()) / DAY) : 0;
  // ανά προμηθευτή: πόσα λείπουν από όσα δήλωσε στο διάστημα· πρώτοι όσοι έχουν τα περισσότερα
  const bySupplier = vats.map((vat) => ({
    vat, name: rows.find((r) => r.supplierVat === vat)!.supplierName,
    missing: rows.filter((r) => r.supplierVat === vat).length,
    total: Math.max(1, all.filter((r) => r.supplierVat === vat && r.status !== "IGNORED").length),
  })).sort((a, b) => b.missing - a.missing).slice(0, 6);

  const recheck = (
    <form action={recheckMissing}>
      <Submit pendingText="Έλεγχος…" className={btn("outline", "sm")}><RefreshCw /> Ξαναέλεγξε τώρα</Submit>
    </form>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-72 flex-1">
          <p className="text-sm">Τιμολόγια που δήλωσαν οι προμηθευτές στο myDATA για εμάς και δεν υπάρχουν στις αγορές</p>
          <p className="text-xs text-muted-foreground tabular-nums">{last ? `Τελευταίος έλεγχος ${time(last.finishedAt ?? last.startedAt)} · από ${day(from)} ως σήμερα` : "Δεν έχει γίνει ακόμα έλεγχος"}</p>
        </div>
        {recheck}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi icon={FileWarning} label="Λείπουν από τις αγορές" tone={rows.length ? (oldestDays > OLD_DAYS ? "danger" : "warning") : "success"} value={rows.length}
          hint={rows.length ? `${euro(missingSum)} · το παλαιότερο ${oldestDays} ημερών. Πέρασέ τα πριν κλείσει ο μήνας` : "Όλα όσα δηλώθηκαν υπάρχουν στις αγορές"} />
        <Kpi icon={BadgeCheck} label="Στο myDATA και σε εμάς" tone={!counted ? "neutral" : found / counted >= 0.9 ? "success" : "warning"}
          value={<>{found} <span className="text-lg text-muted-foreground">από {counted}</span></>}
          hint={counted ? `${Math.round((found / counted) * 100)}% από 1/${from.getUTCMonth() + 1} ως σήμερα` : "Κανένα παραστατικό στο διάστημα"} />
        <Kpi icon={CircleSlash} label="Δεν μας αφορούν" value={ignored} hint="Σημειωμένα, δεν ξαναεμφανίζονται" />
      </div>

      {bySupplier.length ? (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Ανά προμηθευτή <span className="font-normal text-muted-foreground">· όσα λείπουν από όσα δήλωσε</span></h2>
          <ul className="grid gap-2.5">
            {bySupplier.map((s) => (
              <li key={s.vat} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate font-medium" title={s.name}>{s.name}</span>
                <span className="flex h-2.5 overflow-hidden rounded-full bg-success/25" role="img" aria-label={`Λείπουν ${s.missing} από ${s.total}`}>
                  <span className="bg-destructive" style={{ width: `${(s.missing / s.total) * 100}%` }} />
                </span>
                <span className="tabular-nums text-muted-foreground"><b className="font-semibold text-destructive">{s.missing}</b> από {s.total}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-success/25" />Περασμένα</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-destructive" />Λείπουν</span>
          </p>
        </Card>
      ) : null}

      <Card>
        <DataTable
          id="purchases-missing"
          empty="Δεν λείπει κανένα τιμολόγιο από τις αγορές"
          columns={[
            { key: "supplier", label: "Προμηθευτής", required: true, wrap: true },
            { key: "doc", label: "Παραστατικό", wrap: true },
            { key: "date", label: "Ημερομηνία" },
            { key: "store", label: "Αποθήκη" },
            { key: "total", label: "Σύνολο", numeric: true },
          ]}
          rows={rows.map((r) => {
            const credit = CREDIT.test(r.type ?? "");
            const wh = usual.get(r.supplierVat);
            const mine = candidates.filter((c) => c.supplier.vatNumber?.replace(/^EL/i, "") === r.supplierVat);
            const label = `${r.supplierName} · ${[r.series, r.number].filter(Boolean).join("-") || "χωρίς αριθμό"}`;
            return {
              id: r.id,
              cells: {
                supplier: <span className="grid"><b className="font-semibold leading-snug">{r.supplierName}</b><span className="text-xs text-muted-foreground">ΑΦΜ {r.supplierVat}</span></span>,
                doc: <span className="grid"><span>{TYPE_LABEL(r.type)} {[r.series, r.number].filter(Boolean).join("-") || "—"}</span><span className="text-xs text-muted-foreground tabular-nums">MARK {r.mark}</span></span>,
                date: <span className="grid justify-items-start gap-1"><span className="tabular-nums">{day(r.issuedAt)}</span><Age issuedAt={r.issuedAt} now={now} /></span>,
                store: wh ? <span className="grid"><span>{wh.name}</span><span className="text-xs text-muted-foreground">από την τελευταία αγορά</span></span> : <span className="text-xs text-muted-foreground">διάλεξε στο «Πέρασέ το»</span>,
                total: <span className={`whitespace-nowrap font-semibold ${credit ? "text-success-ink" : ""}`}>{credit ? "−" : ""}{euro(r.grossCents ?? 0)}</span>,
              },
              actions: canAdd && warehouses.length ? (
                <Modal label={<><Upload /> Πέρασέ το</>} size="sm" variant="default" title={`Πέρασέ το από το myDATA · ${label}`}>
                  <form action={importMissing} className="grid gap-4 [&>button]:justify-self-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Select label="Αποθήκη παραλαβής" name="warehouseId" required defaultValue={wh?.id ?? ""} options={warehouses.map((w): [string, string] => [w.id, w.name])} />
                    <p className="text-xs text-muted-foreground">Γίνεται πρόχειρο με προμηθευτή, αριθμό, ημερομηνία και ποσά από την ΑΑΔΕ. Τα είδη ταιριάζουν όπως στο σκανάρισμα· ό,τι δεν ταιριάξει το διαλέγεις εσύ. Τίποτα δεν μπαίνει στην αποθήκη πριν το καταχωρίσεις.</p>
                    <FormPending label="Δημιουργία πρόχειρου…" />
                    <Submit pendingText="Δημιουργία…" className={btn("default")}>Φτιάξε πρόχειρο</Submit>
                  </form>
                </Modal>
              ) : null,
              // το DataTable δείχνει τη στήλη ενεργειών μόνο με μενού
              menu: canEdit ? (
                <>
                  {mine.length ? (
                    <Modal menuItem label={<><Link2 /> Το έχω σκαναρισμένο</>} size="sm" title={`Το έχω σκαναρισμένο · ${label}`}>
                      <form action={linkMissing} className="grid gap-4 [&>button]:justify-self-end">
                        <input type="hidden" name="id" value={r.id} />
                        <Select label="Το παραστατικό που περάσαμε" name="purchaseDocId" required hint="Μόνο παραστατικά του ίδιου προμηθευτή που δεν έχουν συνδεθεί"
                          options={mine.map((c): [string, string] => [c.id, `${c.number ?? "χωρίς αριθμό"} · ${day(c.issuedAt)}`])} />
                        <Submit pendingText="Σύνδεση…" className={btn("default")}>Σύνδεσε</Submit>
                      </form>
                    </Modal>
                  ) : null}
                  <Modal menuItem label={<><CircleSlash /> Δεν μας αφορά</>} size="sm" title={`Δεν μας αφορά · ${label}`}>
                    <form action={ignoreMissing} className="grid gap-4 [&>button]:justify-self-end">
                      <input type="hidden" name="id" value={r.id} />
                      <Field label="Γιατί" name="reason" required minLength={3} maxLength={200} hint="π.χ. λάθος ΑΦΜ του προμηθευτή, διπλό παραστατικό" />
                      <Submit pendingText="Αποθήκευση…" className={btn("default")}>Σημείωσέ το</Submit>
                    </form>
                  </Modal>
                </>
              ) : undefined,
            };
          })}
        />
      </Card>
      <p className="text-xs text-muted-foreground">Ο έλεγχος τρέχει κάθε βράδυ για τον τρέχοντα και τον προηγούμενο μήνα. Όσα λείπουν πάνω από {OLD_DAYS} ημέρες μπαίνουν και στις «Εργασίες». Η εφαρμογή μόνο διαβάζει από το myDATA. <Link href="/purchases" className="underline">Όλες οι αγορές</Link></p>
    </div>
  );
}
