import { ProcessFlow } from "@/components/process-flow";
import { RotateCcw } from "lucide-react";
import { notFound } from "next/navigation";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dateTime, FiscalBadge } from "@/lib/labels";
import { euro } from "@/lib/money";
import { currentOrg } from "@/lib/auth";
import { issueCreditNote, syncCreditNote } from "../actions";

const FISCAL_STEP = {
  SIGNED: { state: "done", detail: "Διαβιβάστηκε" },
  PENDING: { state: "current", detail: "Περιμένουμε τη Viva" },
  NOT_SENT: { state: "todo", detail: "Δοκιμαστική: δεν στάλθηκε" },
  FAILED: { state: "failed", detail: "Απέτυχε: θέλει ενέργεια" },
} as const;

// Απόδειξη σε πλάτος θερμικού 80mm. Ctrl/Cmd+P την τυπώνει όπως φαίνεται (το κέλυφος κρύβεται στην εκτύπωση).
export default async function ReceiptPage({ params }: PageProps<"/receipts/[id]">) {
  const { org, can } = await currentOrg("receipts.read");
  const sale = await db.sale.findFirst({
    where: { id: (await params).id, orgId: org.id, status: "COMPLETED" },
    include: { lines: true, payment: { include: { method: true } }, fiscal: true, store: true },
  });
  if (!sale) notFound();
  // πιστωτικά που έχουν εκδοθεί για αυτή την απόδειξη (11.4, συσχετιζόμενα)
  const credits = sale.fiscal ? await db.fiscalDocument.findMany({ where: { orgId: org.id, relatedId: sale.fiscal.id }, orderBy: { createdAt: "desc" } }) : [];
  const creditable = can("receipts.reissue") && sale.fiscal?.status === "SIGNED" && sale.fiscal.docType === "11.1" && !credits.some((c) => c.status !== "FAILED");
  const vat = new Map<number, number>();
  for (const l of sale.lines) vat.set(l.vatRate, (vat.get(l.vatRate) ?? 0) + Math.round((l.quantity * l.unitPriceCents * l.vatRate) / (100 + l.vatRate)));

  return (
    <Page section="Αποδείξεις" title={`Απόδειξη ${sale.series}-${sale.aa}`} description="Για εκτύπωση: Ctrl/Cmd + P">
      <div className="mx-auto mb-4 max-w-3xl rounded-xl border border-border bg-card p-4 print:hidden">
        <ProcessFlow label="Πορεία απόδειξης" steps={[
          { id: "sale", label: "Πώληση", state: "done", detail: sale.issuedAt ? dateTime.format(sale.issuedAt) : undefined },
          { id: "pay", label: "Πληρωμή", state: sale.payment ? "done" : "todo", detail: sale.payment ? `${sale.payment.method.name} · ${euro(sale.totalCents)}` : undefined },
          { id: "aade", label: "Διαβίβαση ΑΑΔΕ", ...FISCAL_STEP[sale.fiscal?.status ?? "NOT_SENT"] },
        ]} />
      </div>
      <article className="mx-auto w-[80mm] max-w-full rounded-lg bg-white p-4 font-mono text-sm leading-relaxed text-black shadow-[var(--shadow-card)] print:shadow-none">
        <header className="text-center">
          <p className="text-lg font-semibold">{org.name}</p>
          <p>{sale.store.name}</p>
          {sale.store.address ? <p>{sale.store.address}</p> : null}
          <p>ΑΦΜ {org.vatNumber}</p>
          <p className="mt-2 font-semibold">ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ</p>
          <p>{sale.series}-{sale.aa} · {sale.issuedAt ? dateTime.format(sale.issuedAt) : ""}</p>
        </header>
        <hr className="my-2 border-dashed border-black" />
        {sale.lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-2">
            <span>{l.quantity} × {l.name}</span>
            <span className="tabular-nums">{euro(l.quantity * l.unitPriceCents)}</span>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between text-lg font-semibold"><span>ΣΥΝΟΛΟ</span><span className="tabular-nums">{euro(sale.totalCents)}</span></div>
        {[...vat].map(([rate, cents]) => (
          <div key={rate} className="flex justify-between"><span>εκ των οποίων ΦΠΑ {rate}%</span><span className="tabular-nums">{euro(cents)}</span></div>
        ))}
        <div className="flex justify-between"><span>Πληρωμή</span><span>{sale.payment ? sale.payment.method.name : ""}</span></div>
        <hr className="my-2 border-dashed border-black" />
        {sale.fiscal?.status === "SIGNED" ? (
          <p className="break-all text-center">Αναφορά: {sale.fiscal.receiptReference}</p>
        ) : (
          <p className="text-center font-semibold">ΔΟΚΙΜΑΣΤΙΚΟ — ΔΕΝ ΑΠΟΤΕΛΕΙ ΦΟΡΟΛΟΓΙΚΟ ΣΤΟΙΧΕΙΟ</p>
        )}
      </article>
      <p className="mt-4 text-center print:hidden">{sale.fiscal ? <FiscalBadge status={sale.fiscal.status} /> : null}</p>
      {creditable || credits.length ? (
        <Card className="mx-auto mt-4 max-w-3xl print:hidden">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Πιστωτικό λιανικής (11.4)</h2>
              <p className="text-sm text-muted-foreground">Πλήρης επιστροφή της απόδειξης, συσχετιζόμενη με αυτήν στο myDATA</p>
            </div>
            {creditable ? (
              <form action={issueCreditNote.bind(null, sale.id)}>
                <Submit className={btn("default")}><RotateCcw /> Έκδοση πιστωτικού</Submit>
              </form>
            ) : null}
          </div>
          {credits.length ? (
            <ul className="border-t border-border/70 px-5 py-3 text-sm">
              {credits.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-1">
                  <span className="min-w-0 flex-1 truncate">{dateTime.format(c.createdAt)} · {c.error ?? c.receiptReference}</span>
                  <FiscalBadge status={c.status} />
                  {c.status === "PENDING" ? (
                    <form action={syncCreditNote.bind(null, c.id, sale.id)}>
                      <Submit className={btn("ghost", "sm")}>Έλεγχος</Submit>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </Page>
  );
}
