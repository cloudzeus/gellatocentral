import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { activateCurrencies, hideCurrencies, saveCurrency, toggleCurrency } from "../actions";

// Κοινά νομίσματα ISO 4217· ο κωδικός παραμένει κλειδωμένος μετά τη δημιουργία.
export default async function CurrenciesPage({ searchParams }: PageProps<"/platform/currencies">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["code", "name", "symbol", "sort", "status"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [
      { code: { contains: list.q, mode: "insensitive" as const } },
      { name: { contains: list.q, mode: "insensitive" as const } },
      { symbol: { contains: list.q, mode: "insensitive" as const } },
    ] } : {}),
  };
  const direction = list.sort ? list.dir : "asc";
  const orderBy = list.sort === "code" ? { code: direction }
    : list.sort === "name" ? { name: direction }
      : list.sort === "symbol" ? { symbol: direction }
        : list.sort === "status" ? { active: direction }
          : [{ sort: direction }, { code: "asc" as const }];
  const [currencies, total, active] = await Promise.all([
    db.currency.findMany({ where, orderBy, skip: list.skip, take: list.take }),
    db.currency.count({ where }),
    db.currency.count({ where: { active: true } }),
  ]);

  const currencyForm = (c?: (typeof currencies)[number]) => (
    <form key={c ? `${c.id}-${c.name}-${c.symbol}-${c.sort}` : "new"} action={saveCurrency} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="currencyId" value={c?.id ?? ""} />
      {c ? <input type="hidden" name="code" value={c.code} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Κωδικός ISO 4217" name={c ? "codeShown" : "code"} required maxLength={3} defaultValue={c?.code} disabled={Boolean(c)} placeholder="EUR"
          hint={c ? "Δεν αλλάζει: είναι η μόνιμη αναφορά του νομίσματος" : "3 λατινικά γράμματα, π.χ. EUR, USD, GBP"} />
        <Field label="Σύμβολο" name="symbol" required maxLength={12} defaultValue={c?.symbol} placeholder="€" hint="π.χ. €, $, £, CHF" />
      </div>
      <Field label="Ονομασία" name="name" required maxLength={60} defaultValue={c?.name} placeholder="Ευρώ" />
      <Field label="Σειρά εμφάνισης" name="sort" type="number" min={0} max={9999} defaultValue={c?.sort ?? 100} hint="Μικρότερο = πιο ψηλά στις επιλογές" />
      <FormPending label="Αποθήκευση νομίσματος…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Common Tables" title="Νομίσματα" description={`${active} ενεργά. Κοινά για όλους τους συνδρομητές, με κωδικό ISO 4217 και σύμβολο`}
      actions={<Modal label={<><Plus /> Νέο νόμισμα</>} size="sm" title="Νέο νόμισμα">{currencyForm()}</Modal>}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε{q.error ? `: ${q.error.slice(0, 200)}` : ""}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Τα νομίσματα ενημερώθηκαν</p> : null}
        <Card>
          <DataTable
            id="currencies"
            bulkActions={[
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateCurrencies },
              { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων νομισμάτων από τις νέες καταχωρίσεις;", run: hideCurrencies },
            ]}
            listing={{ ...list, total, placeholder: "Κωδικός, ονομασία ή σύμβολο…", filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"]] }] }}
            empty="Κανένα νόμισμα ακόμα. Πρόσθεσε το πρώτο με «Νέο νόμισμα»"
            columns={[
              { key: "code", label: "Κωδικός", required: true, sortable: true },
              { key: "name", label: "Ονομασία", sortable: true },
              { key: "symbol", label: "Σύμβολο", sortable: true },
              { key: "sort", label: "Σειρά", numeric: true, sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={currencies.map((c) => ({
              id: c.id,
              cells: {
                code: <span className="font-mono text-xs font-semibold">{c.code}</span>,
                name: <span className="font-semibold">{c.name}</span>,
                symbol: <span className="text-lg font-semibold">{c.symbol}</span>,
                sort: <span className="tabular-nums">{c.sort}</span>,
                status: c.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>,
              },
              details: {
                label: `${c.name} (${c.code})`,
                view: <dl className="grid gap-4 sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Κωδικός ISO</dt><dd className="font-mono text-xs font-semibold">{c.code}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Σύμβολο</dt><dd className="text-lg font-semibold">{c.symbol}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Σειρά</dt><dd className="font-medium tabular-nums">{c.sort}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Κατάσταση</dt><dd>{c.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}</dd></div>
                </dl>,
                edit: currencyForm(c),
              },
              menu: <form action={toggleCurrency.bind(null, c.id)}><Submit className={menuItem}>{c.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>,
            }))}
          />
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Ένα νόμισμα δεν σβήνεται, μόνο κρύβεται από τις νέες καταχωρίσεις. Ο κωδικός ISO δεν αλλάζει μετά τη δημιουργία</p>
        </Card>
      </div>
    </Page>
  );
}
