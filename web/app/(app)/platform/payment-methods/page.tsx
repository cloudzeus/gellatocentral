import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { PAYMENT_LEDGER_LABEL, PAYMENT_PROVIDER_LABEL } from "@/lib/payment-methods";
import type { PaymentLedger, PaymentProvider } from "@/lib/generated/prisma/client";
import { activatePaymentMethods, hidePaymentMethods, savePaymentMethod, togglePaymentMethod } from "../actions";

const PROVIDERS = Object.entries(PAYMENT_PROVIDER_LABEL) as [PaymentProvider, string][];
const LEDGERS = Object.entries(PAYMENT_LEDGER_LABEL) as [PaymentLedger, string][];

// Κοινοί τρόποι πληρωμής: οι αντιστοιχίσεις των επίσημων τρόπων παραμένουν κλειδωμένες.
export default async function PaymentMethodsPage({ searchParams }: PageProps<"/platform/payment-methods">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["code", "name", "provider", "ledger", "pos", "status", "sort"]);
  const provider = filterParam(q, "provider", PROVIDERS.map(([value]) => value));
  const status = filterParam(q, "status", ["active", "hidden"]);
  const pos = filterParam(q, "pos", ["yes", "no"]);
  const where = {
    ...(provider ? { provider } : {}),
    ...(status ? { active: status === "active" } : {}),
    ...(pos ? { posEnabled: pos === "yes" } : {}),
    ...(list.q ? { OR: [{ code: { contains: list.q, mode: "insensitive" as const } }, { name: { contains: list.q, mode: "insensitive" as const } }] } : {}),
  };
  const direction = list.sort ? list.dir : "asc";
  const orderBy = list.sort === "code" ? { code: direction }
    : list.sort === "name" ? { name: direction }
      : list.sort === "provider" ? { provider: direction }
        : list.sort === "ledger" ? { ledgerKind: direction }
          : list.sort === "pos" ? { posEnabled: direction }
            : list.sort === "status" ? { active: direction }
              : [{ sort: direction }, { name: "asc" as const }];
  const [methods, total, active, inPos] = await Promise.all([
    db.paymentMethod.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { _count: { select: { payments: true, parties: true } } } }),
    db.paymentMethod.count({ where }),
    db.paymentMethod.count({ where: { active: true } }),
    db.paymentMethod.count({ where: { active: true, posEnabled: true } }),
  ]);

  const methodForm = (m?: (typeof methods)[number]) => {
    const locked = Boolean(m?.system);
    const mapping = (name: string, value: string | number | null | undefined) => (locked || m ? <input key={name} type="hidden" name={name} value={value ?? ""} /> : null);
    return (
      <form key={m?.id ?? "new"} action={savePaymentMethod} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="methodId" value={m?.id ?? ""} />
        {m ? <input type="hidden" name="code" value={m.code} /> : null}
        <Field label="Κωδικός" name={m ? "codeShown" : "code"} required maxLength={30} defaultValue={m?.code} disabled={Boolean(m)}
          hint={m ? "Δεν αλλάζει: με αυτόν αναφέρονται τα παραστατικά" : "2–30 μικρά λατινικά, αριθμοί ή κάτω παύλα, π.χ. gift_card"} />
        <Field label="Όνομα" name="name" required maxLength={60} defaultValue={m?.name} hint="Η ετικέτα που βλέπει ο ταμίας και ο πελάτης στην απόδειξη" />
        <div className="grid gap-4 sm:grid-cols-2">
          {mapping("provider", m?.provider)}
          <Select label="Πάροχος" name={locked ? "providerShown" : "provider"} disabled={locked} defaultValue={m?.provider ?? "MANUAL"} options={PROVIDERS.map(([v, t]): [string, string] => [v, t])} />
          {mapping("ledgerKind", m?.ledgerKind)}
          <Select label="Λογιστική κατηγορία" name={locked ? "ledgerKindShown" : "ledgerKind"} disabled={locked} defaultValue={m?.ledgerKind ?? "CASH"} options={LEDGERS.map(([v, t]): [string, string] => [v, t])} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mapping("vivaMethodId", m?.vivaMethodId)}
          <Field label="Viva MethodId" name={locked ? "vivaMethodIdShown" : "vivaMethodId"} type="number" min={0} max={999} disabled={locked} defaultValue={m?.vivaMethodId ?? ""} hint="Smart Checkout, π.χ. 0 ή 29" />
          {mapping("vivaPosMethod", m?.vivaPosMethod)}
          <Field label="Viva POS method" name={locked ? "vivaPosMethodShown" : "vivaPosMethod"} maxLength={30} disabled={locked} defaultValue={m?.vivaPosMethod ?? ""} hint="Terminal API, π.χ. CardPresent" />
          {mapping("payItemCase", m?.payItemCase)}
          <Field label="Φορολογικό case" name={locked ? "payItemCaseShown" : "payItemCase"} type="number" min={0} max={255} disabled={locked} defaultValue={m?.payItemCase ?? ""} hint="1 μετρητά, 5 κάρτα· κενό = δεν εκδίδει ΑΛΠ" />
          {mapping("myDataCode", m?.myDataCode)}
          <Field label="Κωδικός myDATA" name={locked ? "myDataCodeShown" : "myDataCode"} type="number" min={1} max={7} disabled={locked} defaultValue={m?.myDataCode ?? ""} hint="Τρόπος πληρωμής 1–7 για B2B" />
        </div>
        <Field label="Σειρά εμφάνισης" name="sort" type="number" min={0} max={9999} defaultValue={m?.sort ?? 100} hint="Μικρότερο = πιο ψηλά στο ταμείο και τις φόρμες" />
        <div className="flex flex-wrap gap-6">
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium"><Checkbox id={`pos-${m?.id ?? "new"}`} name="posEnabled" defaultChecked={m?.posEnabled ?? false} /> Κουμπί στο ταμείο</label>
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium"><Checkbox id={`change-${m?.id ?? "new"}`} name="givesChange" defaultChecked={m?.givesChange ?? false} /> Δίνει ρέστα</label>
        </div>
        <FormPending label="Αποθήκευση τρόπου πληρωμής…" />
        <Submit pendingText="Αποθήκευση…" className={btn("default")}>{m ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Common Tables" title="Τρόποι πληρωμής" description={`${active} ενεργοί · ${inPos} στο ταμείο. Κοινοί για όλη την πλατφόρμα, με κλειδωμένες τις επίσημες αντιστοιχίσεις`}
      actions={<Modal wide label={<><Plus /> Νέος τρόπος</>} size="sm" title="Νέος τρόπος πληρωμής">{methodForm()}</Modal>}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε{q.error ? `: ${q.error.slice(0, 200)}` : ""}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι τρόποι πληρωμής ενημερώθηκαν</p> : null}
        <Card>
          <DataTable
            id="payment-methods"
            bulkActions={[
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activatePaymentMethods },
              { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων τρόπων πληρωμής;", run: hidePaymentMethods },
            ]}
            listing={{ ...list, total, placeholder: "Κωδικός ή όνομα…", filters: [
              { key: "provider", label: "Πάροχος", value: provider, options: PROVIDERS.map(([value, text]): [string, string] => [value, text]) },
              { key: "pos", label: "Ταμείο", value: pos, options: [["yes", "Εμφανίζεται"], ["no", "Δεν εμφανίζεται"]] },
              { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["hidden", "Κρυφοί"]] },
            ] }}
            empty="Κανένας τρόπος ακόμα. Πρόσθεσε τον πρώτο με «Νέος τρόπος»"
            columns={[
              { key: "code", label: "Κωδικός", required: true, sortable: true },
              { key: "name", label: "Όνομα", sortable: true },
              { key: "provider", label: "Πάροχος", sortable: true },
              { key: "fiscal", label: "Φορολογικό" },
              { key: "ledger", label: "Λογιστική", sortable: true },
              { key: "pos", label: "Ταμείο", sortable: true },
              { key: "uses", label: "Χρήσεις", numeric: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={methods.map((m) => ({
              id: m.id,
              cells: {
                code: <span className="font-mono text-xs">{m.code}{m.system ? <span className="ml-1 text-muted-foreground" title="Ορίζεται από την πλατφόρμα">🔒</span> : null}</span>,
                name: <span className="font-semibold">{m.name}</span>,
                provider: PAYMENT_PROVIDER_LABEL[m.provider],
                fiscal: <span className="text-xs">{m.payItemCase !== null ? `case ${m.payItemCase}` : "—"}{m.myDataCode !== null ? ` · myDATA ${m.myDataCode}` : ""}</span>,
                ledger: <span className="text-xs">{PAYMENT_LEDGER_LABEL[m.ledgerKind]}</span>,
                pos: m.posEnabled ? <Badge tone="success">Ναι</Badge> : <Badge>Όχι</Badge>,
                uses: m._count.payments + m._count.parties || "—",
                status: m.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>,
              },
              details: {
                label: m.name,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Πάροχος</dt><dd className="font-medium">{PAYMENT_PROVIDER_LABEL[m.provider]}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Viva</dt><dd className="font-medium">{m.vivaMethodId ?? m.vivaPosMethod ?? "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Σειρά</dt><dd className="font-medium tabular-nums">{m.sort}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Συμπεριφορά</dt><dd className="font-medium">{m.givesChange ? "Δίνει ρέστα" : "Χωρίς ρέστα"}</dd></div>
                </dl>,
                edit: methodForm(m),
              },
              menu: <form action={togglePaymentMethod.bind(null, m.id)}><Submit className={menuItem}>{m.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>,
            }))}
          />
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Ένας τρόπος δεν σβήνεται, μόνο κρύβεται: αποδείξεις και συναλλασσόμενοι που τον έχουν δεν μένουν με κενό. Στους επίσημους (🔒) οι αντιστοιχίσεις της Viva και της ΑΑΔΕ είναι κλειδωμένες</p>
        </Card>
      </div>
    </Page>
  );
}
