import { soldOutIds } from "@/lib/bills";
import { btn, Select } from "@/components/ui";
import { Submit } from "@/components/submit";
import { db } from "@/lib/db";
import { posPaymentMethods } from "@/lib/payment-methods";
import { tillCatalog } from "@/lib/pos-catalog";
import { currentContext } from "@/lib/tenant";
import { vivaConfigured } from "@/lib/viva/cloud-terminal";
import { chooseTill, syncPayment } from "./actions";
import { Till } from "./till";

export default async function PosPage() {
  const ctx = await currentContext();
  const { device, store, tills } = ctx;

  // πληρωμή που έμεινε στη μέση (π.χ. ανανέωση σελίδας): πρώτα ρωτάμε τη Viva
  // (ή μερίδιο λογαριασμού στο τερματικό)
  const waiting = { deviceId: device.id, status: "AWAITING_PAYMENT" } as const;
  const pendingShare = { deviceId: device.id, storeId: store.id, status: "PENDING" } as const;
  const pendingId = (await db.sale.findFirst({ where: waiting, select: { id: true } }))?.id ?? (await db.billShare.findFirst({ where: pendingShare, select: { id: true } }))?.id;
  if (pendingId) await syncPayment(pendingId);

  const [{ categories, frequent }, soldOut, sale, share, last, methods, live, tables] = await Promise.all([
    tillCatalog(ctx.org.id, store.id),
    soldOutIds(ctx),
    db.sale.findFirst({ where: waiting, select: { id: true, totalCents: true, payment: { select: { method: { select: { name: true } } } } } }),
    db.billShare.findFirst({ where: pendingShare, select: { id: true, amountCents: true, method: { select: { name: true } } } }),
    db.sale.findFirst({ where: { deviceId: device.id, status: "COMPLETED" }, orderBy: { issuedAt: "desc" }, select: { id: true, series: true, aa: true, totalCents: true } }),
    posPaymentMethods(),
    vivaConfigured(),
    db.diningTable.count({ where: { orgId: ctx.org.id, storeId: store.id, active: true } }),
  ]);
  const pending = sale ? { id: sale.id, totalCents: sale.totalCents, method: sale.payment?.method.name ?? "" }
    : share ? { id: share.id, totalCents: share.amountCents, method: share.method.name, share: true } : null;

  const header = (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 max-lg:pl-16 lg:px-6 print:hidden">
      <div className="min-w-48 flex-1">
        <h1 className="text-lg font-semibold leading-tight">Ταμείο</h1>
        <p className="text-sm text-muted-foreground tabular-nums">{store.name} · {device.name} · σειρά {device.series} · επόμενη απόδειξη #{device.nextAa}</p>
      </div>
      {tills.length > 1 && !pending ? (
        // πολλά ταμεία στο κατάστημα: ο καθένας δουλεύει στο δικό του, με δικό του τερματικό Viva και αρίθμηση
        <form action={chooseTill} className="flex items-end gap-2">
          <Select label="Ταμείο" name="deviceId" defaultValue={device.id} options={tills.map((t) => [t.id, `${t.name} · ${t.store}`])} />
          <Submit className={btn("outline", "default", "h-9")}>Αλλαγή</Submit>
        </form>
      ) : null}
    </header>
  );

  return (
    <Till
      deviceId={device.id}
      categories={categories}
      frequent={frequent}
      soldOut={soldOut}
      methods={methods.filter((m) => m.payItemCase != null).map((m) => ({ id: m.id, name: m.name, cash: m.ledgerKind === "CASH" }))}
      live={live}
      pending={pending}
      tables={tables > 0}
      last={last && last.aa != null ? { id: last.id, series: last.series ?? "", aa: last.aa, totalCents: last.totalCents } : null}
      header={header}
    />
  );
}
