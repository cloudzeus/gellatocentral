import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { activateVatRates, hideVatRates, saveVatRate, toggleVatRate } from "../actions";

// Κοινοί συντελεστές ΦΠΑ· το ποσοστό που χρησιμοποιείται παραμένει κλειδωμένο.
export default async function VatRatesPage({ searchParams }: PageProps<"/platform/vat-rates">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "rate", "products", "status"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { name: { contains: list.q, mode: "insensitive" as const } } : {}),
  };
  const direction = list.sort ? list.dir : "desc";
  const orderBy = list.sort === "name" ? { name: direction }
    : list.sort === "products" ? { products: { _count: direction } }
      : list.sort === "status" ? { active: direction }
        : { rate: direction };
  const [rates, total, active] = await Promise.all([
    db.vatRate.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { _count: { select: { products: true } } } }),
    db.vatRate.count({ where }),
    db.vatRate.count({ where: { active: true } }),
  ]);
  const rateForm = (r?: (typeof rates)[number]) => {
    const locked = (r?._count.products ?? 0) > 0;
    return (
      <form key={r?.id ?? "new"} action={saveVatRate} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="rateId" value={r?.id ?? ""} />
        <Field label="Όνομα" name="name" required maxLength={40} defaultValue={r?.name} hint="π.χ. Κανονικός, Μειωμένος, Απαλλαγή" />
        {locked ? <input type="hidden" name="rate" value={r!.rate} /> : null}
        <Field label="Ποσοστό %" name={locked ? "rateShown" : "rate"} type="number" required min={0} max={99} step={1} defaultValue={r?.rate ?? ""} disabled={locked} hint={locked ? `Δεν αλλάζει: τον χρησιμοποιούν ήδη ${r!._count.products} προϊόντα` : "Ολόκληρο ποσοστό, π.χ. 24"} />
        <FormPending label="Αποθήκευση συντελεστή…" />
        <Submit pendingText="Αποθήκευση…" className={btn("default")}>{r ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Common Tables" title="Συντελεστές ΦΠΑ" description={`${active} ενεργοί. Κοινοί για όλους τους συνδρομητές και διαθέσιμοι σε προϊόντα και υπηρεσίες`}
      actions={<Modal label={<><Plus /> Νέος συντελεστής</>} size="sm" title="Νέος συντελεστής ΦΠΑ">{rateForm()}</Modal>}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι συντελεστές ενημερώθηκαν</p> : null}
        <Card>
          <DataTable
            id="vat-rates"
            bulkActions={[
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateVatRates },
              { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων συντελεστών από τις νέες καταχωρίσεις;", run: hideVatRates },
            ]}
            listing={{ ...list, total, placeholder: "Όνομα συντελεστή…", filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["hidden", "Κρυφοί"]] }] }}
            empty="Κανένας συντελεστής ακόμα. Πρόσθεσε τον πρώτο με «Νέος συντελεστής»"
            columns={[
              { key: "name", label: "Όνομα", required: true, sortable: true },
              { key: "rate", label: "Ποσοστό", numeric: true, sortable: true },
              { key: "products", label: "Προϊόντα", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={rates.map((r) => ({
              id: r.id,
              cells: {
                name: <span className="font-semibold">{r.name}</span>,
                rate: `${r.rate}%`,
                products: r._count.products || "—",
                status: r.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>,
              },
              details: {
                label: `${r.name} ${r.rate}%`,
                view: <dl className="grid gap-4 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Ποσοστό</dt><dd className="font-medium tabular-nums">{r.rate}%</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Προϊόντα που τον χρησιμοποιούν</dt><dd className="font-medium tabular-nums">{r._count.products}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κατάσταση</dt><dd>{r.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>}</dd></div>
                </dl>,
                edit: rateForm(r),
              },
              menu: <form action={toggleVatRate.bind(null, r.id)}><Submit className={menuItem}>{r.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>,
            }))}
          />
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Ένας συντελεστής δεν σβήνεται, μόνο κρύβεται από τις νέες καταχωρίσεις. Το ποσοστό συντελεστή που χρησιμοποιείται σε προϊόντα δεν αλλάζει</p>
        </Card>
      </div>
    </Page>
  );
}
