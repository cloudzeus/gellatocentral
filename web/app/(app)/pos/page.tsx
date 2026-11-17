import { Banknote, CreditCard, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge, btn, Card, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { currentContext } from "@/lib/tenant";
import { vivaConfigured } from "@/lib/viva/cloud-terminal";
import { addLine, cancelPending, changeQuantity, clearSale, pay, syncPayment } from "./actions";
import { Submit } from "@/components/submit";

export default async function PosPage({ searchParams }: PageProps<"/pos">) {
  const { org, device } = await currentContext();
  const cat = (await searchParams).cat;

  const pendingId = (await db.sale.findFirst({ where: { deviceId: device.id, status: "AWAITING_PAYMENT" }, select: { id: true } }))?.id;
  if (pendingId) await syncPayment(pendingId);

  const [categories, pending, draft, last] = await Promise.all([
    db.category.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" }, include: { products: { where: { active: true }, orderBy: { name: "asc" } } } }),
    db.sale.findFirst({ where: { deviceId: device.id, status: "AWAITING_PAYMENT" } }),
    db.sale.findFirst({ where: { deviceId: device.id, status: "DRAFT" }, include: { lines: { orderBy: { name: "asc" } }, fiscal: true } }),
    db.sale.findFirst({ where: { deviceId: device.id, status: "COMPLETED" }, orderBy: { issuedAt: "desc" } }),
  ]);
  const active = categories.find((c) => c.id === cat) ?? categories[0];
  const lines = draft?.lines ?? [];
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  const live = await vivaConfigured();

  return (
    <Page section="Ταμείο & τιμολόγηση" title="Ταμείο" description={`${device.name} · σειρά ${device.series} · επόμενη απόδειξη #${device.nextAa}`}>
      {pending ? <meta httpEquiv="refresh" content="3" /> : null}
      {!live ? (
        <p className="mb-4 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium">
          Δοκιμαστική λειτουργία: οι αποδείξεις αποθηκεύονται αλλά ΔΕΝ διαβιβάζονται στην ΑΑΔΕ. Δεν έχουν οριστεί κλειδιά Viva.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <section className="min-w-0 space-y-3">
          <div className="scrollbar-hide flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <Link key={c.id} href={`/pos?cat=${c.id}`} className={btn(c.id === active?.id ? "default" : "outline", "default", "h-11 shrink-0 px-5 text-base")}>{c.name}</Link>
            ))}
          </div>
          {categories.length === 0 ? <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-muted-foreground">Δεν υπάρχουν προϊόντα ακόμα. Ο κατάλογος προϊόντων έρχεται στην επόμενη φάση.</p> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {active?.products.map((p) => (
              <form key={p.id} action={addLine.bind(null, p.id)}>
                <Submit disabled={Boolean(pending)} className="flex min-h-28 w-full cursor-pointer flex-col justify-between rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-[border-color,background-color,transform] duration-150 hover:border-gold hover:bg-secondary active:scale-[0.98] disabled:opacity-50">
                  <span className="text-lg font-semibold leading-snug">{p.name}</span>
                  <span className="text-xl font-semibold text-primary tabular-nums">{euro(p.priceCents)}</span>
                </Submit>
              </form>
            ))}
          </div>
        </section>

        <Card className="flex flex-col self-start lg:sticky lg:top-28">
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Τρέχουσα πώληση</h2>
            {lines.length > 0 && !pending ? (
              <form action={clearSale}><Submit className={btn("ghost", "sm")}><Trash2 /> Άδειασμα</Submit></form>
            ) : null}
          </div>

          {pending ? (
            <div className="space-y-4 p-5 text-center">
              <p className="text-3xl font-semibold tabular-nums">{euro(pending.totalCents)}</p>
              <p className="font-medium">Περιμένουμε την πληρωμή στο τερματικό Viva…</p>
              <p className="text-sm text-muted-foreground">Η οθόνη ανανεώνεται μόνη της κάθε 3 δευτερόλεπτα</p>
              <form action={cancelPending.bind(null, pending.id)}><Submit className={btn("outline", "default", "w-full")}>Ακύρωση</Submit></form>
            </div>
          ) : (
            <>
              {draft?.fiscal?.status === "FAILED" ? (
                <p className="m-4 mb-0 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Η προηγούμενη προσπάθεια απέτυχε: {draft.fiscal.error}. Δοκίμασε ξανά.</p>
              ) : null}
              <ul className="divide-y divide-border/70">
                {lines.length === 0 ? <li className="px-5 py-10 text-center text-muted-foreground">Πάτησε ένα προϊόν για να ξεκινήσεις</li> : null}
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{euro(l.unitPriceCents)} · ΦΠΑ {l.vatRate}%</p>
                    </div>
                    <form action={changeQuantity.bind(null, l.id, -1)}><Submit aria-label="Λιγότερο" className={btn("outline", "sm", "size-10! px-0")}><Minus /></Submit></form>
                    <span className="w-6 text-center text-base font-semibold tabular-nums">{l.quantity}</span>
                    <form action={changeQuantity.bind(null, l.id, 1)}><Submit aria-label="Περισσότερο" className={btn("outline", "sm", "size-10! px-0")}><Plus /></Submit></form>
                    <span className="w-18 text-right text-base font-semibold tabular-nums">{euro(l.quantity * l.unitPriceCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-3 border-t border-border/70 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-muted-foreground">Σύνολο</span>
                  <span className="text-3xl font-semibold tabular-nums">{euro(total)}</span>
                </div>
                {lines.length === 0 ? <p className="text-sm text-muted-foreground">Η πληρωμή ανοίγει μόλις μπει το πρώτο προϊόν</p> : null}
                <div className="grid grid-cols-2 gap-3">
                  <form action={pay.bind(null, "CASH")}><Submit disabled={lines.length === 0} className={btn("success", "lg", "w-full")}><Banknote /> Μετρητά</Submit></form>
                  <form action={pay.bind(null, "CARD")}><Submit disabled={lines.length === 0} className={btn("default", "lg", "w-full")}><CreditCard /> Κάρτα</Submit></form>
                </div>
              </div>
            </>
          )}

          {last ? (
            <Link href={`/receipts/${last.id}`} className="flex items-center justify-between border-t border-border/70 px-5 py-3 text-sm hover:bg-secondary">
              <span>Τελευταία απόδειξη {last.series}-{last.aa} · {euro(last.totalCents)}</span>
              <Badge tone="success">Εκτύπωση</Badge>
            </Link>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
