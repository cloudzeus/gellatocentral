import Link from "next/link";
import { Download, Plus, ScanLine } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDoc, importDocs, scanDoc } from "./actions";

const STATUS = { DRAFT: { label: "Πρόχειρο", tone: "warning" }, POSTED: { label: "Καταχωρημένο", tone: "success" }, CANCELLED: { label: "Ακυρωμένο", tone: "neutral" } } as const;
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("el-GR", { timeZone: "UTC" }).format(d) : "—");

// Τιμολόγια αγοράς: χειροκίνητη καταχώριση/σάρωση τώρα, μηχανογραφημένη λήψη από myDATA αργότερα.
export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const { org, can } = await currentOrg("purchases.read");
  const q = await searchParams;
  const [docs, suppliers, warehouses, ocr] = await Promise.all([
    db.purchaseDoc.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" }, take: 100, include: { supplier: true, warehouse: true, _count: { select: { lines: true } } } }),
    db.party.findMany({ where: { orgId: org.id, roles: { has: "supplier" }, active: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } }),
    db.usagePrice.findUnique({ where: { service: "ocr" }, select: { active: true } }),
  ]);

  const docForm = (
    <form action={createDoc} className="grid gap-4 [&>button]:justify-self-end">
      <Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((p): [string, string] => [p.id, p.name])} />
      <Select label="Αποθήκη παραλαβής" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} />
      <Field label="Αριθμός τιμολογίου" name="number" maxLength={40} hint="Όπως τυπώνεται στο παραστατικό του προμηθευτή" />
      <Field label="Ημερομηνία έκδοσης" name="issuedAt" type="date" />
      <Field label="Σημείωση" name="note" maxLength={200} />
      <Submit className={btn("default")}>Δημιουργία</Submit>
    </form>
  );

  const scanForm = (
    <form action={scanDoc} className="grid gap-4 [&>button]:justify-self-end">
      <Select label="Προμηθευτής" name="supplierId" required options={suppliers.map((p): [string, string] => [p.id, p.name])} />
      <Select label="Αποθήκη παραλαβής" name="warehouseId" required options={warehouses.map((w): [string, string] => [w.id, w.name])} />
      <label className="grid gap-1.5 text-sm font-medium">
        Φωτογραφία τιμολογίου
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" required
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground" />
        <span className="text-xs font-normal text-muted-foreground">JPG, PNG ή WebP έως 8 MB — η υπηρεσία χρεώνεται ανά έγγραφο</span>
      </label>
      <Submit className={btn("default")}>Σάρωση</Submit>
    </form>
  );

  const today = new Date().toISOString().slice(0, 10);
  const quarterStart = new Date(); quarterStart.setUTCMonth(quarterStart.getUTCMonth() - 3);
  const mydataForm = (
    <form action={importDocs} className="grid gap-4 [&>button]:justify-self-end">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Από" name="dateFrom" type="date" required defaultValue={quarterStart.toISOString().slice(0, 10)} />
        <Field label="Έως" name="dateTo" type="date" required defaultValue={today} />
      </div>
      <p className="text-xs text-muted-foreground">Φέρνει τα τιμολόγια αγοράς που έχουν εκδόσει οι προμηθευτές σου (RequestMyIncome). Όσα έχουν ήδη ληφθεί παραλείπονται. Γίνονται πρόχειρα για έλεγχο πριν την καταχώριση.</p>
      <Submit className={btn("default")}>Λήψη</Submit>
    </form>
  );

  return (
    <Page section="Αποθήκη & αγορές" title="Τιμολόγια αγοράς" description="Παραλαβές από προμηθευτές: η αποδοχή γράφει αποθέματα και παρτίδες και ενημερώνει τις τιμές"
      actions={can("purchases.add") && suppliers.length && warehouses.length ? (
        <span className="flex gap-2">
          {org.aadeUserId && org.aadeSubKey ? <Modal label={<><Download /> Λήψη από myDATA</>} size="sm" title="Λήψη τιμολογίων από myDATA">{mydataForm}</Modal> : null}
          {ocr?.active ? <Modal label={<><ScanLine /> Σάρωση τιμολογίου</>} size="sm" title="Σάρωση τιμολογίου (OCR)">{scanForm}</Modal> : null}
          <Modal label={<><Plus /> Νέο τιμολόγιο</>} size="sm" title="Νέο τιμολόγιο αγοράς">{docForm}</Modal>
        </span>
      ) : null}>
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 200)}</p> : null}
        {typeof q.saved === "string" && q.saved !== "1" ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{q.saved.slice(0, 200)}</p> : null}
        {docs.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {!suppliers.length || !warehouses.length ? <>Χρειάζεσαι πρώτα <Link href="/parties" className="underline">προμηθευτή</Link> και <Link href="/inventory" className="underline">αποθήκη</Link></> : "Κανένα τιμολόγιο αγοράς ακόμα"}
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Προμηθευτής</th><th className="px-3 py-2 font-semibold">Αριθμός</th><th className="px-3 py-2 font-semibold">Ημερομηνία</th><th className="px-3 py-2 font-semibold">Αποθήκη</th><th className="px-3 py-2 font-semibold">Γραμμές</th><th className="px-3 py-2 font-semibold">Κατάσταση</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-border/70">
                    <td className="px-5 py-2 font-medium"><Link href={`/purchases/${d.id}`} className="hover:underline">{d.supplier.name}</Link></td>
                    <td className="px-3 py-2 tabular-nums">{d.number ?? "—"}</td>
                    <td className="px-3 py-2">{day(d.issuedAt)}</td>
                    <td className="px-3 py-2">{d.warehouse.name}</td>
                    <td className="px-3 py-2 tabular-nums">{d._count.lines}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Page>
  );
}
