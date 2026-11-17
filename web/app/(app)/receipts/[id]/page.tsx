import { notFound } from "next/navigation";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dateTime, FiscalBadge, METHOD } from "@/lib/labels";
import { euro } from "@/lib/money";
import { currentOrg } from "@/lib/auth";

// Απόδειξη σε πλάτος θερμικού 80mm. Ctrl/Cmd+P την τυπώνει όπως φαίνεται (το κέλυφος κρύβεται στην εκτύπωση).
export default async function ReceiptPage({ params }: PageProps<"/receipts/[id]">) {
  const { org } = await currentOrg("receipts.view");
  const sale = await db.sale.findFirst({
    where: { id: (await params).id, orgId: org.id, status: "COMPLETED" },
    include: { lines: true, payment: true, fiscal: true, store: true },
  });
  if (!sale) notFound();
  const vat = new Map<number, number>();
  for (const l of sale.lines) vat.set(l.vatRate, (vat.get(l.vatRate) ?? 0) + Math.round((l.quantity * l.unitPriceCents * l.vatRate) / (100 + l.vatRate)));

  return (
    <Page section="Αποδείξεις" title={`Απόδειξη ${sale.series}-${sale.aa}`} description="Για εκτύπωση: Ctrl/Cmd + P">
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
        <div className="flex justify-between"><span>Πληρωμή</span><span>{sale.payment ? METHOD[sale.payment.method] : ""}</span></div>
        <hr className="my-2 border-dashed border-black" />
        {sale.fiscal?.status === "SIGNED" ? (
          <p className="break-all text-center">Αναφορά: {sale.fiscal.receiptReference}</p>
        ) : (
          <p className="text-center font-semibold">ΔΟΚΙΜΑΣΤΙΚΟ — ΔΕΝ ΑΠΟΤΕΛΕΙ ΦΟΡΟΛΟΓΙΚΟ ΣΤΟΙΧΕΙΟ</p>
        )}
      </article>
      <p className="mt-4 text-center print:hidden">{sale.fiscal ? <FiscalBadge status={sale.fiscal.status} /> : null}</p>
    </Page>
  );
}
