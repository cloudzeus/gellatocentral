import { CircleAlert, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { RoutedModal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { STORES_CODE } from "@/lib/cost-centers-rules";
import { db } from "@/lib/db";
import { listExpenseCategories } from "@/lib/expense-categories-db";
import { E3_LABEL, KIND_LABEL, KINDS, VAT_LABEL } from "@/lib/expense-rules";
import { euro } from "@/lib/money";
import { requireStockContext } from "@/lib/stock-context";
import { saveLimitAction, saveTypeAction } from "./actions";
import { TypeFields } from "./type-fields";

const SOURCE: Record<string, { label: string; tone: "neutral" | "success" | "warning" }> = {
  SEED: { label: "προεπιλογή", tone: "neutral" }, ACCOUNTANT: { label: "από λογιστή", tone: "warning" }, USER: { label: "από εμάς", tone: "success" },
};
const VATS: [string, string][] = [["VAT_361", VAT_LABEL.VAT_361], ["VAT_362", VAT_LABEL.VAT_362], ["VAT_365", VAT_LABEL.VAT_365], ["", "Χωρίς (απαλλαγή ή μισθοδοσία)"]];

export default async function ExpenseTypesPage({ searchParams }: PageProps<"/finance/expense-types">) {
  const ctx = await requireStockContext("finance.read");
  const q = await searchParams;
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const canEdit = ctx.can("finance.edit");
  const [types, centers, org] = await Promise.all([
    listExpenseCategories(ctx.orgId),
    db.costCenter.findMany({ where: { orgId: ctx.orgId, active: true, storeId: null, code: { not: STORES_CODE } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { expenseApprovalCents: true } }),
  ]);
  const missing = types.filter((t) => t.active && !t.accountCode).length;
  const editing = str("edit") ? types.find((t) => t.id === str("t")) : undefined;
  const showForm = canEdit && (str("new") === "1" || !!editing);
  const error = str("error") || null;
  const form = editing ?? null;

  return (
    <Page section="Οικονομικά" title="Τύποι εξόδων"
      description="Κάθε δαπάνη έχει τύπο. Ο τύπος λέει πώς δηλώνεται στο myDATA, σε ποιον λογαριασμό του λογιστή πάει και σε ποιο κέντρο κόστους. Οι προεπιλογές είναι προτάσεις: ο λογιστής τις αλλάζει και η αλλαγή του μετρά πρώτη"
      actions={canEdit ? <Link href="?new=1" scroll={false} className={btn("default")}><Plus aria-hidden />Νέος τύπος</Link> : undefined}>
      {error && !showForm ? <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p> : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b px-5 py-4">
            <h2 className="font-semibold">{types.length} τύποι</h2>
            {missing ? <span className="flex items-center gap-1.5 text-xs text-warning-ink"><CircleAlert className="size-3.5" aria-hidden />{missing} χωρίς λογαριασμό · ο λογιστής τους συμπληρώνει πριν από την εξαγωγή</span> : <span className="text-xs text-muted-foreground">Όλοι έχουν λογαριασμό λογιστή</span>}
          </div>
          <ul className="divide-y">
            {types.map((t) => (
              <li key={t.id} className={cn("flex min-w-0 items-start gap-3 px-5 py-3", !t.active && "opacity-60", t.id === str("t") && "bg-primary/6")}>
                <span className="w-8 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{t.code}</span>
                <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
                  <div className="min-w-0">
                    <b className="block font-medium">{t.name}</b>
                    <small className="text-xs text-muted-foreground">{KIND_LABEL[t.kind] ?? t.kind} · {t._count.expenses ? `${t._count.expenses} δαπάνες` : "καμία δαπάνη"}{t.active ? "" : " · ανενεργός"}</small>
                  </div>
                  <div className="min-w-0">
                    <b className="block font-medium">{t.mydataType ? E3_LABEL[t.mydataType] ?? t.mydataType : "Χωρίς χαρακτηρισμό"}</b>
                    <small className="break-all font-mono text-xs text-muted-foreground">{t.mydataCategory ?? ""}{t.mydataType ? ` · ${t.mydataType}` : ""}{t.mydataVatType ? ` · ${t.mydataVatType}` : ""}</small>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 md:flex-col md:items-start">
                    {t.accountCode ? <span className="font-mono text-xs">{t.accountCode}</span> : <Badge tone="warning" icon={CircleAlert}>λείπει λογαριασμός</Badge>}
                    <Badge tone={SOURCE[t.source]?.tone ?? "neutral"}>{SOURCE[t.source]?.label ?? t.source}</Badge>
                  </div>
                  <small className="text-xs text-muted-foreground md:col-span-3">Κέντρο κόστους: {t.costCenter ? `${t.costCenter.code} · ${t.costCenter.name}` : "του καταστήματος"}</small>
                </div>
                {canEdit ? <Link href={`?t=${t.id}&edit=1`} scroll={false} className={btn("ghost", "sm")} aria-label={`Αλλαγή τύπου ${t.code}`} title="Αλλαγή"><Pencil aria-hidden /></Link> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="grid gap-3 p-5">
          <h2 className="font-semibold">Όριο έγκρισης</h2>
          <p className="text-sm text-muted-foreground">Δαπάνη με σύνολο πάνω από το όριο περιμένει έγκριση από άλλον, και πληρώνεται μετά. Κανείς δεν εγκρίνει δική του, εκτός από όποιον διαχειρίζεται τους χρήστες.</p>
          <p className="text-2xl font-semibold tabular-nums">{org.expenseApprovalCents != null ? euro(org.expenseApprovalCents) : "Χωρίς όριο"}</p>
          {ctx.can("finance.approve") ? (
            <form action={saveLimitAction} className="grid gap-2">
              <Field label="Νέο όριο €" name="limit" inputMode="decimal" defaultValue={org.expenseApprovalCents != null ? (org.expenseApprovalCents / 100).toFixed(2) : ""} hint="Άδειο = καμία δαπάνη δεν περιμένει έγκριση" />
              <Submit className={btn("outline")}>Αποθήκευση ορίου</Submit>
            </form>
          ) : <p className="text-xs text-muted-foreground">Το αλλάζει όποιος έχει δικαίωμα έγκρισης.</p>}
        </Card>
      </div>

      {showForm ? (
        <RoutedModal wide title={form ? `${form.code} · ${form.name}` : "Νέος τύπος εξόδου"} description="Ο χαρακτηρισμός ελέγχεται με τους πίνακες της ΑΑΔΕ πριν αποθηκευτεί" closeHref={form ? `?t=${form.id}` : "?"}>
          <form action={saveTypeAction} className="grid gap-3 sm:grid-cols-2">
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">{error}</p> : null}
            {form ? <input type="hidden" name="id" value={form.id} /> : null}
            <Field label="Κωδικός" name="code" required maxLength={20} defaultValue={form?.code ?? ""} className="font-mono" />
            <Select label="Είδος στο αποτέλεσμα" name="kind" defaultValue={form?.kind ?? "OPEX"} options={KINDS.map((k): [string, string] => [k, KIND_LABEL[k]])} />
            <div className="sm:col-span-2"><Field label="Όνομα" name="name" required maxLength={120} defaultValue={form?.name ?? ""} /></div>
            <TypeFields category={form?.mydataCategory ?? null} type={form?.mydataType ?? null} />
            <Select label="Τύπος ΦΠΑ" name="mydataVatType" defaultValue={form ? form.mydataVatType ?? "" : "VAT_361"} options={VATS} hint="Σε δαπάνη χωρίς ΦΠΑ δεν στέλνεται" />
            <Select label="Κέντρο κόστους" name="costCenterId" defaultValue={form?.costCenterId ?? ""} options={[["", "Του καταστήματος"], ...centers.map((c): [string, string] => [c.id, `${c.code} · ${c.name}`])]} hint="Χωρίς κατάστημα στη δαπάνη, πάει εδώ" />
            <Field label="Λογαριασμός" name="accountCode" maxLength={40} defaultValue={form?.accountCode ?? ""} className="font-mono" placeholder="π.χ. 62.00.01" />
            <Field label="Λογαριασμός ΦΠΑ" name="vatAccountCode" maxLength={40} defaultValue={form?.vatAccountCode ?? ""} className="font-mono" placeholder="π.χ. 54.00.24" />
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="byAccountant" defaultChecked={form?.source === "ACCOUNTANT"} /> Το όρισε ο λογιστής</label>
            {form ? <Select label="Κατάσταση" name="active" defaultValue={String(form.active)} options={[["true", "Ενεργός"], ["false", "Ανενεργός (δεν εμφανίζεται σε νέες δαπάνες)"]]} /> : null}
            <p className="text-xs text-muted-foreground sm:col-span-2">Ο χαρακτηρισμός είναι πρόταση για τον λογιστή: στη δαπάνη ελέγχεται ξανά με τον τύπο του παραστατικού.</p>
            <Submit className={btn("default", "default", "sm:col-span-2")}>Αποθήκευση</Submit>
          </form>
        </RoutedModal>
      ) : null}
    </Page>
  );
}
