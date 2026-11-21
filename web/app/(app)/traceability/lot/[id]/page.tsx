import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scale, TriangleAlert } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FlowGraphView } from "@/components/flow-graph";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { listParams } from "@/lib/paging";
import { daysUntil } from "@/lib/production";
import { lotTraceGraph } from "@/lib/traceability-graph";
import { formatBaseQty } from "@/lib/units";
import { correctLotStock } from "../../actions";

const SOURCE_LABEL: Record<string, string> = { purchase: "Αγορά", production: "Παραγωγή", manual: "Διόρθωση", sale: "Πώληση" };

// Οθόνη ανάκλησης ΕΦΕΤ: ένα βήμα πίσω και ένα βήμα μπροστά, Καν. 178/2002 αρ. 18.
export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("production.read");
  const { id } = await params;
  const q = await searchParams;
  const list = listParams(q, 50, ["batch", "recipe", "produced", "output", "quantity", "occurred", "source", "note", "user"]);
  const lot = await db.stockLot.findFirst({
    where: { id, orgId: org.id },
    include: {
      genericItem: { include: { baseUnit: true } },
      warehouse: { select: { name: true } },
      document: { select: { id: true, number: true, issuedAt: true, supplier: { select: { id: true, name: true } } } },
    },
  });
  if (!lot) notFound();

  const [movements, consumedIn, history] = await Promise.all([
    db.stockMovement.groupBy({ by: ["source"], where: { orgId: org.id, lotId: lot.id }, _sum: { quantity: true } }),
    db.productionBatchItem.findMany({ where: { orgId: org.id, lotId: lot.id }, orderBy: { batch: { producedAt: "desc" } }, include: { batch: { select: { id: true, batchNumber: true, producedAt: true, quantityGrams: true, recipe: { select: { name: true } } } } } }),
    db.stockMovement.findMany({ where: { orgId: org.id, lotId: lot.id }, orderBy: { occurredAt: "desc" }, take: 30 }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const fmtQty = (qty: number) => formatBaseQty(qty, [lot.genericItem.baseUnit.dimension === "mass" ? { code: "kg", dimension: "mass", toBase: 1_000_000 } : lot.genericItem.baseUnit.dimension === "volume" ? { code: "l", dimension: "volume", toBase: 1_000 } : { code: "τεμ", dimension: "count", toBase: 1 }]);

  const intake = movements.filter((m) => (m._sum.quantity ?? 0) > 0).reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
  const remaining = movements.reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
  const consumed = intake - remaining;
  const daysLeft = daysUntil(lot.expiresAt);

  const graph = lotTraceGraph({
    lot: { id: lot.id, batchNumber: lot.batchNumber, itemName: lot.genericItem.name, expiresLabel: lot.expiresAt ? dayFmt.format(lot.expiresAt) : null, expired: daysLeft != null && daysLeft < 0 },
    document: lot.document ? { id: lot.document.id, number: lot.document.number, issuedLabel: lot.document.issuedAt ? dayFmt.format(lot.document.issuedAt) : "—", supplierName: lot.document.supplier.name } : null,
    consumptions: consumedIn.map((i) => ({ batchId: i.batch.id, batchNumber: i.batch.batchNumber, recipeName: i.batch.recipe.name, producedLabel: dayFmt.format(i.batch.producedAt), quantityLabel: fmtQty(i.quantity) })),
  });

  const consumptions = [...consumedIn];
  if (list.sort && ["batch", "recipe", "produced", "output", "quantity"].includes(list.sort)) consumptions.sort((a, b) => {
    const value = (i: (typeof consumptions)[number]) => list.sort === "batch" ? i.batch.batchNumber
      : list.sort === "recipe" ? i.batch.recipe.name
        : list.sort === "produced" ? i.batch.producedAt.getTime()
          : list.sort === "output" ? i.batch.quantityGrams
            : i.quantity;
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });
  const movementsPage = [...history];
  if (list.sort && ["occurred", "source", "quantity", "note", "user"].includes(list.sort)) movementsPage.sort((a, b) => {
    const value = (m: (typeof movementsPage)[number]) => list.sort === "occurred" ? m.occurredAt.getTime()
      : list.sort === "source" ? SOURCE_LABEL[m.source] ?? m.source
        : list.sort === "quantity" ? m.quantity
          : list.sort === "note" ? m.note ?? ""
            : m.createdByName ?? "";
    const av = value(a), bv = value(b);
    const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "el") : Number(av) - Number(bv);
    return list.dir === "asc" ? result : -result;
  });

  return (
    <Page section="Παραγωγή" title={`Παρτίδα ${lot.batchNumber ?? "(χύμα)"} — ${lot.genericItem.name}`}
      description={`${lot.warehouse.name}${lot.document ? ` · ${lot.document.supplier.name}${lot.document.number ? ` · τιμολόγιο ${lot.document.number}` : ""}` : " · χειροκίνητη καταχώριση"}`}
      actions={<div className="flex gap-2"><Link href="/traceability" className={btn("outline", "sm")}><ArrowLeft /> Ιχνηλασιμότητα</Link>{can("warehouses.edit") ? <Modal label={<><Scale /> Διόρθωση υπολοίπου</>} size="sm" title={`Διόρθωση: ${lot.genericItem.name} (${lot.batchNumber ?? "χύμα"})`}><form action={correctLotStock} className="grid gap-4 [&>button]:justify-self-end"><input type="hidden" name="lotId" value={lot.id} /><p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">Τρέχον υπόλοιπο: <strong className="tabular-nums">{fmtQty(remaining)}</strong> — η διόρθωση γράφεται ως κίνηση με αιτιολογία και το όνομά σου.</p><div className="grid gap-4 sm:grid-cols-2"><Select label="Κατεύθυνση" name="direction" options={[["in", "Προσθήκη (βρέθηκε παραπάνω)"], ["out", "Αφαίρεση (απώλεια / μέτρηση)"]]} /><Field label={`Ποσότητα (${lot.genericItem.baseUnit.dimension === "mass" ? "g" : lot.genericItem.baseUnit.dimension === "volume" ? "ml" : "τεμ"})`} name="amount" required inputMode="numeric" pattern="[0-9]+" hint="Θετικός ακέραιος — η αφαίρεση δεν μπορεί να ξεπερνά το υπόλοιπο" /></div><Field label="Αιτιολογία" name="note" required minLength={3} maxLength={200} placeholder="π.χ. Σπάσιμο συσκευασίας — πραγματικό περιεχόμενο, Μέτρηση απογραφής" /><Submit className={btn("default")}>Καταχώριση διόρθωση</Submit></form></Modal> : null}</div>}>
      <div className="grid max-w-7xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η διόρθωση καταχωρήθηκε</p> : null}
        {daysLeft != null && daysLeft < 0 ? <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"><TriangleAlert className="size-4" /> Η παρτίδα έληξε {-daysLeft} ημέρες πριν — αν υπάρχει υπόλοιπο, αποσύρεται και καταγράφεται ως απόσυρση.</p> : daysLeft != null && daysLeft <= 14 ? <p role="status" className="flex items-center gap-2 rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink"><TriangleAlert className="size-4" /> Λήγει σε {daysLeft} ημέρες — η FEFO την προτεραιοποιεί στις παραγωγές.</p> : null}

        <Card><dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4"><div><dt className="text-xs text-muted-foreground">Είσοδος</dt><dd className="font-medium tabular-nums">{fmtQty(intake)}</dd></div><div><dt className="text-xs text-muted-foreground">Καταναλώθηκε</dt><dd className="font-medium tabular-nums">{fmtQty(consumed)}</dd></div><div><dt className="text-xs text-muted-foreground">Υπόλοιπο</dt><dd className="font-medium tabular-nums">{fmtQty(remaining)}</dd></div><div><dt className="text-xs text-muted-foreground">Λήξη</dt><dd className="font-medium">{lot.expiresAt ? dayFmt.format(lot.expiresAt) : "—"}{daysLeft != null && daysLeft >= 0 ? <span className="text-xs text-muted-foreground"> ({daysLeft} ημ.)</span> : null}</dd></div></dl></Card>

        <Card><div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Διαδρομή παρτίδας</h2><p className="text-sm text-muted-foreground">Από τον προμηθευτή έως τις παραγωγές — σύρε για τακτοποίηση, κλικ σε κόμβο για την καρτέλα του</p></div><FlowGraphView graph={graph} /></Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Πού καταναλώθηκε</h2><p className="text-sm text-muted-foreground">{consumedIn.length ? `${consumedIn.length} αναλώσεις σε παραγωγές — σε ανάκληση, αυτές οι παρτίδες αποσύρονται` : "Δεν έχει καταναλωθεί σε παραγωγή"}</p></div>
          <DataTable
            id={`lot-${lot.id}-consumptions`}
            listing={{ ...list, total: consumptions.length, placeholder: "Παρτίδα ή συνταγή…", showSearch: false }}
            empty="Δεν έχει καταναλωθεί σε παραγωγή"
            columns={[
              { key: "batch", label: "Παρτίδα παραγωγής", required: true, sortable: true },
              { key: "recipe", label: "Συνταγή", sortable: true },
              { key: "produced", label: "Ημερομηνία", sortable: true },
              { key: "output", label: "Παράχθηκε", numeric: true, sortable: true },
              { key: "quantity", label: "Από αυτή την παρτίδα", numeric: true, sortable: true },
            ]}
            rows={consumptions.map((i) => ({
              id: i.id,
              cells: {
                batch: <Link href={`/production/${i.batch.id}`} className="font-semibold tabular-nums underline-offset-2 hover:underline">{i.batch.batchNumber}</Link>,
                recipe: i.batch.recipe.name,
                produced: dayFmt.format(i.batch.producedAt),
                output: `${(i.batch.quantityGrams / 1000).toLocaleString("el-GR")} kg`,
                quantity: fmtQty(i.quantity),
              },
              details: {
                label: i.batch.batchNumber,
                view: <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{i.batch.recipe.name} · {dayFmt.format(i.batch.producedAt)} · {fmtQty(i.quantity)}</span><Link href={`/production/${i.batch.id}`} className={btn("outline", "sm")}>Άνοιγμα παραγωγής</Link></div>,
              },
            }))}
          />
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Κινήσεις παρτίδας</h2><p className="text-sm text-muted-foreground">Κάθε είσοδος, κατανάλωση και διόρθωση — με αιτιολογία και χρήστη</p></div>
          <DataTable
            id={`lot-${lot.id}-movements`}
            listing={{ ...list, total: movementsPage.length, placeholder: "Αιτιολογία ή χρήστης…", showSearch: false }}
            empty="Καμία κίνηση στην παρτίδα"
            columns={[
              { key: "occurred", label: "Ημερομηνία", required: true, sortable: true },
              { key: "source", label: "Τύπος", sortable: true },
              { key: "quantity", label: "Ποσότητα", numeric: true, sortable: true },
              { key: "note", label: "Αιτιολογία", sortable: true },
              { key: "user", label: "Χρήστης", sortable: true },
            ]}
            rows={movementsPage.map((m) => ({
              id: m.id,
              cells: {
                occurred: <span className="tabular-nums">{timeFmt.format(m.occurredAt)}</span>,
                source: <Badge tone={m.source === "manual" ? "warning" : m.source === "purchase" ? "success" : "neutral"}>{SOURCE_LABEL[m.source] ?? m.source}</Badge>,
                quantity: <span className={m.quantity < 0 ? "text-destructive" : "text-success-ink"}>{m.quantity > 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))}</span>,
                note: m.note ?? "—",
                user: m.createdByName ?? "—",
              },
              details: {
                label: `${SOURCE_LABEL[m.source] ?? m.source} · ${timeFmt.format(m.occurredAt)}`,
                view: <dl className="grid gap-4 sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">Ποσότητα</dt><dd className="font-medium">{m.quantity > 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))}</dd></div><div><dt className="text-xs text-muted-foreground">Αιτιολογία</dt><dd className="font-medium">{m.note ?? "—"}</dd></div><div><dt className="text-xs text-muted-foreground">Χρήστης</dt><dd className="font-medium">{m.createdByName ?? "—"}</dd></div></dl>,
              },
            }))}
          />
        </Card>

        <p className="px-1 text-xs text-muted-foreground"><Badge>Καν. 178/2002 αρ. 18</Badge> Ένα βήμα πίσω: {lot.document ? `προμηθευτής «${lot.document.supplier.name}»` : "χωρίς τιμολόγιο"} — ένα βήμα μπροστά: οι παραγωγές που την κατανάλωσαν.</p>
      </div>
    </Page>
  );
}
