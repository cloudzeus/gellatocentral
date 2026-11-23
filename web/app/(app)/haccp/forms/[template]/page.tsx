import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, btn, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { assessTenant } from "@/lib/haccp/assessment-db";
import { ALLERGENS, haccpForm } from "@/lib/haccp/forms";
import { sourceById } from "@/lib/haccp/sources";
import { PrintButton } from "./print-button";

const date = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeZone: "Europe/Athens" });
const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
type Row = string[];
const emptyRows = (count: number, columns: number): Row[] => Array.from({ length: count }, () => Array(columns).fill(""));

export default async function PrintableHaccpForm({ params }: { params: Promise<{ template: string }> }) {
  const [{ template: id }, ctx] = await Promise.all([params, currentOrg("haccp.read")]);
  const template = haccpForm(id);
  if (!template) notFound();
  const scoped = ctx.storeIds.length ? { in: ctx.storeIds } : undefined;
  let columns = [...template.columns];
  let rows: Row[] = emptyRows(template.rows, columns.length);
  let note = "Τα κενά πεδία συμπληρώνονται από τον υπεύθυνο. Οι αυτόματες τιμές προέρχονται μόνο από καταχωρισμένα δεδομένα.";

  if (template.autoFill === "devices") {
    const devices = await db.device.findMany({ where: { orgId: ctx.org.id, active: true, kind: { in: ["FRIDGE", "VENDING_MACHINE"] }, ...(scoped ? { storeId: scoped } : {}) }, include: { store: { select: { name: true } }, readings: { where: { kind: "TEMPERATURE" }, orderBy: { at: "desc" }, take: 1 } }, orderBy: { name: "asc" } });
    rows = devices.map((device) => [device.readings[0] ? dateTime.format(device.readings[0].at) : "", `${device.name} · ${device.store.name}`, device.readings[0] ? `${device.readings[0].value}` : "", `${device.tempMin ?? "—"}…${device.tempMax ?? "—"}`, device.readings[0] && (device.tempMin === null || device.readings[0].value >= device.tempMin) && (device.tempMax === null || device.readings[0].value <= device.tempMax) ? "Εντός" : "Έλεγχος", "", ""]);
    rows.push(...emptyRows(Math.max(0, template.rows - rows.length), columns.length));
  } else if (template.autoFill === "receipts") {
    const docs = await db.purchaseDoc.findMany({ where: { orgId: ctx.org.id, status: "POSTED" }, include: { supplier: { select: { name: true } }, lines: { orderBy: { description: "asc" } } }, orderBy: { createdAt: "desc" }, take: 20 });
    rows = docs.flatMap((doc) => doc.lines.map((line) => [doc.issuedAt ? date.format(doc.issuedAt) : date.format(doc.createdAt), `${doc.supplier.name} · ${doc.number ?? "χωρίς αριθμό"}`, `${line.description} · ${line.batchNumber ?? "—"}`, line.expiresAt ? date.format(line.expiresAt) : "", line.receiptTempC?.toString() ?? "", line.receiptIssue ?? "Καταχωρισμένη αποδοχή", line.receiptIssue ? "Αξιολόγηση" : ""]));
    rows.push(...emptyRows(Math.max(0, template.rows - rows.length), columns.length));
  } else if (template.autoFill === "production") {
    const batches = await db.productionBatch.findMany({ where: { orgId: ctx.org.id }, include: { recipe: { select: { name: true } }, warehouse: { select: { name: true } }, _count: { select: { items: true } } }, orderBy: { producedAt: "desc" }, take: 30 });
    rows = batches.map((batch) => template.id === "traceability" ? [batch.batchNumber, dateTime.format(batch.producedAt), `${batch._count.items} γραμμές υλικών — άνοιγμα πλήρους ιχνηλασιμότητας`, `${batch.quantityGrams / 1000} kg`, batch.warehouse.name, ""] : [`${batch.batchNumber} · ${batch.recipe.name}`, dateTime.format(batch.producedAt), "", "", "", "", ""]);
    rows.push(...emptyRows(Math.max(0, template.rows - rows.length), columns.length));
  } else if (template.autoFill === "suppliers") {
    const suppliers = await db.party.findMany({ where: { orgId: ctx.org.id, active: true, roles: { has: "supplier" } }, orderBy: { name: "asc" }, take: 40 });
    rows = suppliers.map((supplier) => [supplier.name, "", "", "Εκκρεμεί αξιολόγηση", "", ""]);
    rows.push(...emptyRows(Math.max(0, template.rows - rows.length), columns.length));
  } else if (template.autoFill === "recipes") {
    const recipes = await db.recipe.findMany({ where: { orgId: ctx.org.id, active: true }, include: { items: { include: { genericItem: { select: { name: true } } } } }, orderBy: { name: "asc" }, take: 40 });
    if (template.id === "allergen-matrix") {
      columns = ["Προϊόν", ...ALLERGENS, "Διασταυρούμενη επαφή", "Έκδοση / έγκριση"];
      rows = recipes.map((recipe) => [recipe.name, ...Array(ALLERGENS.length + 2).fill("")]);
      note = "Τα αλλεργιογόνα ΔΕΝ συμπληρώνονται αυτόματα από ονόματα υλικών. Επαληθεύσε ετικέτες, τεχνικά δελτία, συνταγή και διασταυρούμενη επαφή πριν την έγκριση.";
    } else rows = recipes.map((recipe) => [recipe.name, recipe.items.map((item) => item.genericItem.name).join(", "), "", "", "", ""]);
    rows.push(...emptyRows(Math.max(0, template.rows - rows.length), columns.length));
  } else if (template.autoFill === "assessment") {
    const assessment = await assessTenant(ctx.org.id, { storeIds: ctx.storeIds });
    rows = assessment.findings.map((item) => [item.severity === "HIGH" ? "Κρίσιμο" : item.severity === "MEDIUM" ? "Προσοχή" : "Παρατήρηση", item.title, item.detail, item.action, "", ""]);
    note = `Δείκτης πληρότητας τεκμηρίωσης: ${assessment.score}/100 · ${assessment.critical} κρίσιμα · ${assessment.warnings} προειδοποιήσεις. Δεν αποτελεί πιστοποίηση.`;
  }

  return <Page section="HACCP" title={template.title} description={`${template.category} · ${ctx.org.name}`} actions={<div className="print:hidden flex gap-2"><Link href="/haccp?view=forms" className={btn("outline", "sm")}><ArrowLeft /> Έντυπα</Link><PrintButton /></div>}>
    <article className="mx-auto grid max-w-[100rem] gap-5 print:block">
      <header className="rounded-xl border border-border bg-card px-6 py-5 print:border-0 print:px-0"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{ctx.org.name} · ΑΦΜ {ctx.org.vatNumber}</p><h1 className="mt-2 text-2xl font-semibold">{template.title}</h1><p className="mt-1 text-sm">{template.category} · Ημερομηνία παραγωγής {dateTime.format(new Date())}</p></div><Badge tone={template.basis === "LEGAL" ? "warning" : "neutral"}>{template.basis === "LEGAL" ? "Συνδέεται με νομική υποχρέωση" : "Υποστηρικτικό πρότυπο"}</Badge></div></header>
      <section className="rounded-xl border border-border bg-card px-6 py-4 text-sm print:border-0 print:px-0"><p><strong>Σκοπός:</strong> {template.purpose}</p><p className="mt-2"><strong>Οδηγίες:</strong> {template.instructions}</p><p className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 print:border print:border-border">{note}</p></section>
      <div className="overflow-x-auto rounded-xl border border-border bg-card print:overflow-visible print:rounded-none"><table className="w-full border-collapse text-xs print:text-[8pt]"><thead><tr className="bg-secondary/40">{columns.map((column, index) => <th key={`${column}-${index}`} className="min-w-24 border border-border px-2 py-3 text-left font-semibold">{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="h-12 print:h-9">{columns.map((_, colIndex) => <td key={colIndex} className="min-w-24 border border-border px-2 py-2 align-top">{row[colIndex] || "\u00a0"}</td>)}</tr>)}</tbody></table></div>
      <footer className="grid gap-4 rounded-xl border border-border bg-card px-6 py-5 text-sm md:grid-cols-3 print:border-0 print:px-0"><p>Υπεύθυνος συμπλήρωσης: ____________________</p><p>Έλεγχος / έγκριση: ____________________</p><p>Ημερομηνία: ____________________</p><div className="md:col-span-3"><strong>Πηγές αναφοράς:</strong><ul className="mt-2 space-y-1 text-xs">{template.sourceIds.map((sourceId) => { const source = sourceById(sourceId); return source ? <li key={sourceId}>{source.authority} — {source.title}: {source.url}</li> : null; })}</ul></div></footer>
    </article>
  </Page>;
}
