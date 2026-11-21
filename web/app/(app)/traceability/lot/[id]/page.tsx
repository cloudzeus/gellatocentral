import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scale, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { FlowGraphView } from "@/components/flow-graph";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { lotTraceGraph } from "@/lib/traceability-graph";
import { formatBaseQty } from "@/lib/units";
import { correctLotStock } from "../../actions";

const SOURCE_LABEL: Record<string, string> = { purchase: "Αγορά", production: "Παραγωγή", manual: "Διόρθωση", sale: "Πώληση" };

// Καρτέλα παρτίδας υλικού — η οθόνη ανάκλησης του ΕΦΕΤ: από πού ήρθε (προμηθευτής, τιμολόγιο)
// και ΠΟΥ ΠΗΓΕ (σε ποιες παρτίδες παραγωγής καταναλώθηκε, πόσο και πότε). Καν. 178/2002 αρ. 18.
export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("production.read");
  const { id } = await params;
  const q = await searchParams;
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
    db.productionBatchItem.findMany({
      where: { orgId: org.id, lotId: lot.id },
      orderBy: { batch: { producedAt: "desc" } },
      include: { batch: { select: { id: true, batchNumber: true, producedAt: true, quantityGrams: true, recipe: { select: { name: true } } } } },
    }),
    db.stockMovement.findMany({ where: { orgId: org.id, lotId: lot.id }, orderBy: { occurredAt: "desc" }, take: 30 }),
  ]);
  const dayFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
  const fmtQty = (qty: number) =>
    formatBaseQty(qty, [lot.genericItem.baseUnit.dimension === "mass" ? { code: "kg", dimension: "mass", toBase: 1_000_000 } : lot.genericItem.baseUnit.dimension === "volume" ? { code: "l", dimension: "volume", toBase: 1_000 } : { code: "τεμ", dimension: "count", toBase: 1 }]);

  const intake = movements.filter((m) => (m._sum.quantity ?? 0) > 0).reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
  const remaining = movements.reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
  const consumed = intake - remaining;
  const daysLeft = lot.expiresAt ? Math.ceil((lot.expiresAt.getTime() - Date.now()) / 86_400_000) : null;

  // Η διαδρομή της παρτίδας ως γράφημα: προμηθευτής → τιμολόγιο → παρτίδα → παραγωγές.
  const graph = lotTraceGraph({
    lot: {
      id: lot.id,
      batchNumber: lot.batchNumber,
      itemName: lot.genericItem.name,
      expiresLabel: lot.expiresAt ? dayFmt.format(lot.expiresAt) : null,
      expired: daysLeft != null && daysLeft < 0,
    },
    document: lot.document
      ? { id: lot.document.id, number: lot.document.number, issuedLabel: lot.document.issuedAt ? dayFmt.format(lot.document.issuedAt) : "—", supplierName: lot.document.supplier.name }
      : null,
    consumptions: consumedIn.map((i) => ({
      batchId: i.batch.id,
      batchNumber: i.batch.batchNumber,
      recipeName: i.batch.recipe.name,
      producedLabel: dayFmt.format(i.batch.producedAt),
      quantityLabel: fmtQty(i.quantity),
    })),
  });

  return (
    <Page
      section="Παραγωγή"
      title={`Παρτίδα ${lot.batchNumber ?? "(χύμα)"} — ${lot.genericItem.name}`}
      description={`${lot.warehouse.name}${lot.document ? ` · ${lot.document.supplier.name}${lot.document.number ? ` · τιμολόγιο ${lot.document.number}` : ""}` : " · χειροκίνητη καταχώριση"}`}
      actions={
        <div className="flex gap-2">
          <Link href="/traceability" className={btn("outline", "sm")}>
            <ArrowLeft /> Ιχνηλασιμότητα
          </Link>
          {can("warehouses.edit") ? (
            <Modal label={<><Scale /> Διόρθωση υπολοίπου</>} size="sm" title={`Διόρθωση: ${lot.genericItem.name} (${lot.batchNumber ?? "χύμα"})`}>
              <form action={correctLotStock} className="grid gap-4 [&>button]:justify-self-end">
                <input type="hidden" name="lotId" value={lot.id} />
                <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                  Τρέχον υπόλοιπο: <strong className="tabular-nums">{fmtQty(remaining)}</strong> — η διόρθωση γράφεται ως κίνηση με αιτιολογία και το όνομά σου.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Κατεύθυνση" name="direction" options={[["in", "Προσθήκη (βρέθηκε παραπάνω)"], ["out", "Αφαίρεση (απώλεια / μέτρηση)"]]} />
                  <Field
                    label={`Ποσότητα (${lot.genericItem.baseUnit.dimension === "mass" ? "g" : lot.genericItem.baseUnit.dimension === "volume" ? "ml" : "τεμ"})`}
                    name="amount"
                    required
                    inputMode="numeric"
                    pattern="[0-9]+"
                    hint="Θετικός ακέραιος — η αφαίρεση δεν μπορεί να ξεπερνά το υπόλοιπο"
                  />
                </div>
                <Field label="Αιτιολογία" name="note" required minLength={3} maxLength={200} placeholder="π.χ. Σπάσιμο συσκευασίας — πραγματικό περιεχόμενο, Μέτρηση απογραφής" />
                <Submit className={btn("default")}>Καταχώριση διόρθωσης</Submit>
              </form>
            </Modal>
          ) : null}
        </div>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η διόρθωση καταχωρήθηκε</p> : null}
        {daysLeft != null && daysLeft < 0 ? (
          <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            <TriangleAlert className="size-4" /> Η παρτίδα έληξε {-daysLeft} ημέρες πριν — αν υπάρχει υπόλοιπο, αποσύρεται και καταγράφεται ως απόσυρση.
          </p>
        ) : daysLeft != null && daysLeft <= 14 ? (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-gold/15 px-4 py-3 text-sm font-medium text-gold-ink">
            <TriangleAlert className="size-4" /> Λήγει σε {daysLeft} ημέρες — η FEFO την προτεραιοποιεί στις παραγωγές.
          </p>
        ) : null}

        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Είσοδος</dt>
              <dd className="font-medium tabular-nums">{fmtQty(intake)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Καταναλώθηκε</dt>
              <dd className="font-medium tabular-nums">{fmtQty(consumed)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Υπόλοιπο</dt>
              <dd className="font-medium tabular-nums">{fmtQty(remaining)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Λήξη</dt>
              <dd className="font-medium">{lot.expiresAt ? dayFmt.format(lot.expiresAt) : "—"}{daysLeft != null && daysLeft >= 0 ? <span className="text-xs text-muted-foreground"> ({daysLeft} ημ.)</span> : null}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Διαδρομή παρτίδας</h2>
            <p className="text-sm text-muted-foreground">Από τον προμηθευτή έως τις παραγωγές — σύρε για τακτοποίηση, κλικ σε κόμβο για την καρτέλα του</p>
          </div>
          <FlowGraphView graph={graph} />
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Πού καταναλώθηκε</h2>
            <p className="text-sm text-muted-foreground">
              {consumedIn.length ? `${consumedIn.length} αναλώσεις σε παραγωγές — σε ανάκληση, αυτές οι παρτίδες αποσύρονται` : "Δεν έχει καταναλωθεί σε παραγωγή"}
            </p>
          </div>
          {consumedIn.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Παρτίδα παραγωγής</th>
                    <th className="px-3 py-2 font-semibold">Συνταγή</th>
                    <th className="px-3 py-2 font-semibold">Ημερομηνία</th>
                    <th className="px-3 py-2 text-right font-semibold">Παράχθηκε</th>
                    <th className="px-5 py-2 text-right font-semibold">Από αυτή την παρτίδα</th>
                  </tr>
                </thead>
                <tbody>
                  {consumedIn.map((i) => (
                    <tr key={i.id} className="border-t border-border/70">
                      <td className="px-5 py-2 font-medium">
                        <Link href={`/production/${i.batch.id}`} className="hover:underline tabular-nums">{i.batch.batchNumber}</Link>
                      </td>
                      <td className="px-3 py-2">{i.batch.recipe.name}</td>
                      <td className="px-3 py-2">{dayFmt.format(i.batch.producedAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(i.batch.quantityGrams / 1000).toLocaleString("el-GR")} kg</td>
                      <td className="px-5 py-2 text-right tabular-nums">{fmtQty(i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Κινήσεις παρτίδας</h2>
            <p className="text-sm text-muted-foreground">Κάθε είσοδος, κατανάλωση και διόρθωση — με αιτιολογία και χρήστη</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Ημερομηνία</th>
                  <th className="px-3 py-2 font-semibold">Τύπος</th>
                  <th className="px-3 py-2 text-right font-semibold">Ποσότητα</th>
                  <th className="px-3 py-2 font-semibold">Αιτιολογία</th>
                  <th className="px-5 py-2 font-semibold">Χρήστης</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => (
                  <tr key={m.id} className="border-t border-border/70">
                    <td className="px-5 py-2 tabular-nums">{timeFmt.format(m.occurredAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={m.source === "manual" ? "warning" : m.source === "purchase" ? "success" : "neutral"}>{SOURCE_LABEL[m.source] ?? m.source}</Badge>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${m.quantity < 0 ? "text-destructive" : "text-success-ink"}`}>
                      {m.quantity > 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))}
                    </td>
                    <td className="px-3 py-2">{m.note ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-5 py-2">{m.createdByName ?? <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="px-1 text-xs text-muted-foreground">
          <Badge tone="neutral">Καν. 178/2002 αρ. 18</Badge> Ένα βήμα πίσω: {lot.document ? `προμηθευτής «${lot.document.supplier.name}»` : "χωρίς τιμολόγιο"} — ένα βήμα μπροστά: οι παραγωγές που την κατανάλωσαν. Η διασύνδεση παραγωγής → πωλήσεων βιτρίνας έρχεται στο επόμενο βήμα.
        </p>
      </div>
    </Page>
  );
}
