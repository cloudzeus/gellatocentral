import { Banknote, CreditCard, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge, btn, Card, cn, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { currentContext } from "@/lib/tenant";
import { vivaConfigured } from "@/lib/viva/cloud-terminal";
import { addLine, cancelPending, changeQuantity, clearSale, pay, syncPayment } from "./actions";

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
  const live = vivaConfigured();

  return (
    <Page section="Ταμείο & τιμολόγηση" title="Ταμείο" description={`${device.name} · σειρά ${device.series} · επόμενη απόδειξη #${device.nextAa}`}>
      {pending ? <meta httpEquiv="refresh" content="3" /> : null}
      {!live ? (
        <p className="mb-4 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-semibold">
          Δοκιμαστική λειτουργία: οι αποδείξεις αποθηκεύονται αλλά ΔΕΝ διαβιβάζονται στην ΑΑΔΕ. Δεν έχουν οριστεί κλειδιά Viva.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <section className="min-w-0 space-y-3">
          <div className="scrollbar-hide flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <Link key={c.id} href={`/pos?cat=${c.id}`} className={btn(c.id === active?.id ? "default" : "outline")}>{c.name}</Link>
            ))}
          </div>
          {categories.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-muted-foreground">Δεν υπάρχουν προϊόντα ακόμα. Ο κατάλογος προϊόντων έρχεται στην επόμενη φάση.</p> : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {active?.products.map((p) => (
              <form key={p.id} action={addLine.bind(null, p.id)}>
                <button disabled={Boolean(pending)} className="flex min-h-24 w-full cursor-pointer flex-col justify-between rounded-2xl border border-border/70 bg-card p-4 text-left shadow-[var(--shadow-card)] transition-all duration-200 hover:border-gold hover:bg-secondary active:scale-[0.98] disabled:opacity-50">
                  <span className="text-base font-bold leading-snug">{p.name}</span>
                  <span className="text-lg font-extrabold text-primary tabular-nums">{euro(p.priceCents)}</span>
                </button>
              </form>
            ))}
          </div>
        </section>

        <Card className="flex flex-col self-start lg:sticky lg:top-28">
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Τρέχουσα πώληση</h2>
            {lines.length > 0 && !pending ? (
              <form action={clearSale}><button className={btn("ghost", "sm")}><Trash2 /> Άδειασμα</button></form>
            ) : null}
          </div>

          {pending ? (
            <div className="space-y-4 p-5 text-center">
              <p className="text-3xl font-extrabold tabular-nums">{euro(pending.totalCents)}</p>
              <p className="font-semibold">Περιμένουμε την πληρωμή στο τερματικό Viva…</p>
              <p className="text-sm text-muted-foreground">Η οθόνη ανανεώνεται μόνη της κάθε 3 δευτερόλεπτα.</p>
              <form action={cancelPending.bind(null, pending.id)}><button className={btn("outline", "default", "w-full")}>Ακύρωση</button></form>
            </div>
          ) : (
            <>
              {draft?.fiscal?.status === "FAILED" ? (
                <p className="m-4 mb-0 rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">Η προηγούμενη προσπάθεια απέτυχε: {draft.fiscal.error}. Δοκίμασε ξανά.</p>
              ) : null}
              <ul className="divide-y divide-border/70">
                {lines.length === 0 ? <li className="px-5 py-10 text-center text-muted-foreground">Πάτησε ένα προϊόν για να ξεκινήσεις.</li> : null}
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{euro(l.unitPriceCents)} · ΦΠΑ {l.vatRate}%</p>
                    </div>
                    <form action={changeQuantity.bind(null, l.id, -1)}><button aria-label="Λιγότερο" className={btn("outline", "sm")}><Minus /></button></form>
                    <span className="w-6 text-center font-extrabold tabular-nums">{l.quantity}</span>
                    <form action={changeQuantity.bind(null, l.id, 1)}><button aria-label="Περισσότερο" className={btn("outline", "sm")}><Plus /></button></form>
                    <span className="w-16 text-right font-bold tabular-nums">{euro(l.quantity * l.unitPriceCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-3 border-t border-border/70 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-muted-foreground">Σύνολο</span>
                  <span className="text-3xl font-extrabold tabular-nums">{euro(total)}</span>
                </div>
                <div className={cn("grid grid-cols-2 gap-3", lines.length === 0 && "pointer-events-none opacity-50")}>
                  <form action={pay.bind(null, "CASH")}><button className={btn("success", "lg", "w-full")}><Banknote /> Μετρητά</button></form>
                  <form action={pay.bind(null, "CARD")}><button className={btn("default", "lg", "w-full")}><CreditCard /> Κάρτα</button></form>
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
