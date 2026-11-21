import { Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { PAYMENT_LEDGER_LABEL, PAYMENT_PROVIDER_LABEL } from "@/lib/payment-methods";
import type { PaymentLedger, PaymentProvider } from "@/lib/generated/prisma/client";
import { savePaymentMethod, togglePaymentMethod } from "../actions";

const PROVIDERS = Object.entries(PAYMENT_PROVIDER_LABEL) as [PaymentProvider, string][];
const LEDGERS = Object.entries(PAYMENT_LEDGER_LABEL) as [PaymentLedger, string][];

// Οι κοινοί τρόποι πληρωμής: προεπιλογή όσοι υποστηρίζει η Viva (system) και όσους προσθέτει η πλατφόρμα.
export default async function PaymentMethodsPage({ searchParams }: PageProps<"/platform/payment-methods">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const methods = await db.paymentMethod.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], include: { _count: { select: { payments: true, parties: true } } } });

  const methodForm = (m?: (typeof methods)[number]) => {
    // system: οι αντιστοιχίσεις (Viva/φορολογική/λογιστική) κλειδώνουν — αλλάζουν μόνο όνομα, σειρά και συμπεριφορά στο ταμείο
    const locked = Boolean(m?.system);
    const mapping = (name: string, value: string | number | null | undefined) => (locked || m ? <input key={name} type="hidden" name={name} value={value ?? ""} /> : null);
    return (
      <form key={m ? `${m.code}-${m.name}` : "new"} action={savePaymentMethod} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="methodId" value={m?.id ?? ""} />
        {m ? <input type="hidden" name="code" value={m.code} /> : null}
        <Field label="Κωδικός" name={m ? "codeShown" : "code"} required maxLength={30} defaultValue={m?.code} disabled={Boolean(m)}
          hint={m ? "Δεν αλλάζει: με αυτόν αναφέρονται τα παραστατικά" : "2–30 μικρά λατινικά, αριθμοί ή κάτω παύλα, π.χ. gift_card"} />
        <Field label="Όνομα" name="name" required maxLength={60} defaultValue={m?.name} hint="Η ετικέτα που βλέπει ο ταμίας και ο πελάτης στην απόδειξη" />
        {mapping("provider", m?.provider)}
        <Select label="Πάροχος" name={locked ? "providerShown" : "provider"} disabled={locked} defaultValue={m?.provider ?? "MANUAL"} options={PROVIDERS.map(([v, t]): [string, string] => [v, t])} />
        {mapping("ledgerKind", m?.ledgerKind)}
        <Select label="Λογιστική κατηγορία" name={locked ? "ledgerKindShown" : "ledgerKind"} disabled={locked} defaultValue={m?.ledgerKind ?? "CASH"} options={LEDGERS.map(([v, t]): [string, string] => [v, t])} />
        <div className="grid grid-cols-2 gap-4">
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
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="posEnabled" defaultChecked={m?.posEnabled ?? false} className="size-4 accent-[var(--primary)]" /> Κουμπί στο ταμείο</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="givesChange" defaultChecked={m?.givesChange ?? false} className="size-4 accent-[var(--primary)]" /> Δίνει ρέστα</label>
        </div>
        <Submit className={btn("default")}>{m ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Common Tables" title="Τρόποι πληρωμής" description="Κοινοί για όλη την πλατφόρμα. Προεπιλογή όσοι υποστηρίζει η Viva· από εδώ προστίθενται και άλλοι">
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε{q.error ? `: ${q.error.slice(0, 200)}` : ""}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι τρόποι πληρωμής ενημερώθηκαν</p> : null}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Τρόποι</h2><p className="text-sm text-muted-foreground">{methods.length ? `${methods.filter((m) => m.active).length} ενεργοί από ${methods.length} · ${methods.filter((m) => m.posEnabled && m.active).length} στο ταμείο` : "Κανένας τρόπος ακόμα"}</p></div>
            <Modal label={<><Plus /> Νέος τρόπος</>} size="sm" title="Νέος τρόπος πληρωμής">{methodForm()}</Modal>
          </div>
          {methods.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Κωδικός</th><th className="px-3 py-2 font-semibold">Όνομα</th><th className="px-3 py-2 font-semibold">Πάροχος</th>
                    <th className="px-3 py-2 font-semibold">Φορολογικό</th><th className="px-3 py-2 font-semibold">Λογιστική</th><th className="px-3 py-2 font-semibold">Ταμείο</th>
                    <th className="px-3 py-2 text-right font-semibold">Χρήσεις</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => (
                    <tr key={m.id} className={cn("border-t border-border/70", m.active ? "" : "text-muted-foreground")}>
                      <td className="px-5 py-2 font-mono text-xs">{m.code}{m.system ? <span className="ml-1 text-muted-foreground" title="Ορίζεται από την πλατφόρμα">🔒</span> : null}</td>
                      <td className="px-3 py-2 font-medium">{m.name}</td>
                      <td className="px-3 py-2">{PAYMENT_PROVIDER_LABEL[m.provider]}</td>
                      <td className="px-3 py-2 text-xs">{m.payItemCase !== null ? `case ${m.payItemCase}` : "—"}{m.myDataCode !== null ? ` · myDATA ${m.myDataCode}` : ""}</td>
                      <td className="px-3 py-2 text-xs">{PAYMENT_LEDGER_LABEL[m.ledgerKind]}</td>
                      <td className="px-3 py-2">{m.posEnabled ? <Badge tone="success">Ναι</Badge> : <Badge>Όχι</Badge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m._count.payments + m._count.parties || "—"}</td>
                      <td className="px-3 py-2">{m.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>}</td>
                      <td className="px-5 py-1.5"><span className="flex justify-end gap-1"><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={m.name}>{methodForm(m)}</Modal><form action={togglePaymentMethod.bind(null, m.id)}><Submit className={btn("ghost", "sm")}>{m.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένας τρόπος ακόμα. Πρόσθεσε τον πρώτο με το «Νέος τρόπος»</p>}
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Ένας τρόπος δεν σβήνεται, μόνο κρύβεται: αποδείξεις και συναλλασσόμενοι που τον έχουν δεν μένουν με κενό. Στους επίσημους (🔒) οι αντιστοιχίσεις της Viva και της ΑΑΔΕ είναι κλειδωμένες</p>
        </Card>
      </div>
    </Page>
  );
}
