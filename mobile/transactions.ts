// Οθόνη «Συναλλαγές»: σύνολα ημέρας και εισπράξεις ανά ώρα από τις γραμμές του server (web/lib/pos-transactions.ts).
export type TxState = "paid" | "pos" | "refunded" | "refunding";
export type Tx = {
  kind: "sale" | "credit" | "share";
  id: string;
  at: string;
  label: string;
  cents: number;
  state: TxState;
  method: string;
  cash: boolean;
  card: string | null;
  table: string | null;
  note: string | null;
  mark: string | null;
  lines: { name: string; quantity: number; cents: number }[];
  pays: { cash: boolean; cents: number }[];
  refundable: boolean;
  creditId: string | null;
};
export type Filter = "all" | "card" | "cash" | "refunds";

/** Εισπράξεις (κάρτα/μετρητά), αποδείξεις, μέση απόδειξη, επιστροφές. Τα πιστωτικά δεν αφαιρούνται από τις εισπράξεις. */
export function summary(rows: Tx[]) {
  let card = 0, cash = 0, refunds = 0, refundCount = 0, receipts = 0, receiptCents = 0;
  for (const r of rows) {
    if (r.kind === "credit") { refunds += r.cents; refundCount++; continue; }
    if (r.state === "pos") continue;
    for (const p of r.pays) { if (p.cash) cash += p.cents; else card += p.cents; }
    if (r.kind === "sale") { receipts++; receiptCents += r.cents; }
  }
  return { incomeCents: card + cash, cardCents: card, cashCents: cash, receipts, avgCents: receipts ? Math.round(receiptCents / receipts) : 0, refundCents: refunds, refundCount };
}

/** Εισπράξεις ανά ώρα (κάρτα/μετρητά). Τουλάχιστον 09:00–21:00, μεγαλώνει αν υπάρχουν κινήσεις έξω από αυτό. */
export function hourly(rows: Tx[], now: Date) {
  const by = new Map<number, { card: number; cash: number }>();
  for (const r of rows) {
    if (r.kind === "credit" || r.state === "pos") continue;
    const h = new Date(r.at).getHours();
    const b = by.get(h) ?? { card: 0, cash: 0 };
    for (const p of r.pays) { if (p.cash) b.cash += p.cents; else b.card += p.cents; }
    by.set(h, b);
  }
  const hours = [...by.keys()];
  const from = Math.min(9, ...hours), to = Math.max(21, ...hours);
  const out = [];
  for (let h = from; h <= to; h++) out.push({ hour: h, ...(by.get(h) ?? { card: 0, cash: 0 }), now: h === now.getHours() });
  const peak = out.reduce((a, b) => (b.card + b.cash > a.card + a.cash ? b : a), out[0]);
  return { bars: out, max: Math.max(1, ...out.map((b) => b.card + b.cash)), peak: peak.card + peak.cash > 0 ? peak : null };
}

export const matches = (r: Tx, f: Filter) =>
  f === "all" ? true : f === "refunds" ? r.kind === "credit" || r.state === "refunded" || r.state === "refunding" : r.kind !== "credit" && (f === "cash") === r.cash;
