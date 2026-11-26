// Οθόνη «Συναλλαγές» του ταμείου Android: ό,τι εισπράχθηκε ή επιστράφηκε σε μία ημέρα σε αυτό το ταμείο.
import { db } from "./db";
import { athensDayRange } from "./production-day-close";
import { cardLabel, terminalFiscal } from "./viva/sign";

export type TxState = "paid" | "pos" | "refunded" | "refunding";
export type Tx = {
  kind: "sale" | "credit" | "share";
  id: string;
  at: string;
  label: string;
  cents: number; // πιστωτικό: αρνητικό
  state: TxState;
  method: string;
  cash: boolean;
  card: string | null;
  table: string | null;
  note: string | null;
  mark: string | null;
  lines: { name: string; quantity: number; cents: number }[];
  /** Για τα σύνολα: πώς πληρώθηκε (στο μοίρασμα κατά ποσό μια απόδειξη έχει πολλές πληρωμές). */
  pays: { cash: boolean; cents: number }[];
  refundable: boolean;
  creditId: string | null; // πιστωτικό σε αναμονή (για «Έλεγχος»/«Ακύρωση»)
};

const isCash = (m: { code: string; givesChange: boolean }) => m.givesChange || m.code === "cash";
const label = (s: { series: string | null; aa: number | null }) => (s.series && s.aa != null ? `${s.series} · ${s.aa}` : "Χωρίς αριθμό");

type Ctx = { org: { id: string }; device: { id: string } };

export async function dayTransactions(ctx: Ctx, isoDate: string): Promise<Tx[]> {
  const { start, end } = athensDayRange(isoDate);
  const inDay = { gte: start, lt: end };
  const method = { select: { name: true, code: true, givesChange: true } };
  const [sales, credits, shares] = await Promise.all([
    db.sale.findMany({
      where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: { in: ["COMPLETED", "AWAITING_PAYMENT"] }, OR: [{ issuedAt: inDay }, { issuedAt: null, createdAt: inDay }] },
      select: {
        id: true, status: true, series: true, aa: true, totalCents: true, issuedAt: true, createdAt: true,
        bill: { select: { table: { select: { name: true } } } },
        lines: { select: { name: true, quantity: true, unitPriceCents: true } },
        payment: { select: { amountCents: true, raw: true, method } },
        shares: { where: { status: "PAID" }, select: { amountCents: true, raw: true, method } },
        fiscal: { select: { docType: true, status: true, mark: true, response: true, creditedBy: { where: { status: { not: "FAILED" } }, select: { id: true, status: true } } } },
      },
    }),
    db.fiscalDocument.findMany({
      where: { orgId: ctx.org.id, docType: "11.4", status: { not: "FAILED" }, createdAt: inDay, related: { sale: { deviceId: ctx.device.id } } },
      select: { id: true, status: true, createdAt: true, response: true, related: { select: { sale: { select: { series: true, aa: true, totalCents: true, payment: { select: { raw: true, method } } } } } } },
    }),
    // μερίδια λογαριασμού που περιμένουν στο POS ή πληρώθηκαν και περιμένουν ακόμα την απόδειξη του υπολοίπου
    db.billShare.findMany({
      where: { orgId: ctx.org.id, deviceId: ctx.device.id, createdAt: inDay, OR: [{ status: "PENDING" }, { status: "PAID", saleId: null }] },
      select: { id: true, status: true, amountCents: true, createdAt: true, raw: true, method, bill: { select: { table: { select: { name: true } } } } },
    }),
  ]);

  const rows: Tx[] = [];
  for (const s of sales) {
    const credit = s.fiscal?.creditedBy[0];
    const m = s.payment?.method;
    const pays = [
      ...s.shares.map((x) => ({ cash: isCash(x.method), cents: x.amountCents })),
      ...(s.payment && s.status === "COMPLETED" ? [{ cash: isCash(s.payment.method), cents: s.payment.amountCents }] : []),
    ];
    rows.push({
      kind: "sale", id: s.id, at: (s.issuedAt ?? s.createdAt).toISOString(), label: label(s), cents: s.totalCents,
      state: s.status === "AWAITING_PAYMENT" ? "pos" : credit ? (credit.status === "PENDING" ? "refunding" : "refunded") : "paid",
      method: m?.name ?? "", cash: m ? isCash(m) : false, card: cardLabel(s.payment?.raw), table: s.bill?.table?.name ?? null,
      note: s.shares.length ? `${s.shares.length + 1} πληρωμές` : null,
      mark: s.fiscal?.mark ?? terminalFiscal(s.fiscal?.response).mark ?? null,
      lines: s.lines.map((l) => ({ name: l.name, quantity: l.quantity, cents: l.unitPriceCents * l.quantity })),
      pays,
      // shortcut: απόδειξη με πολλές πληρωμές (μοίρασμα) δεν επιστρέφεται από το ταμείο, γιατί η επιστροφή πάει όλη σε μία κάρτα· χρειάζεται επιστροφή ανά πληρωμή
      refundable: s.status === "COMPLETED" && !credit && !s.shares.length && s.fiscal?.docType === "11.1" && s.fiscal.status === "SIGNED",
      creditId: credit?.status === "PENDING" ? credit.id : null,
    });
  }
  for (const c of credits) {
    const sale = c.related?.sale;
    const m = sale?.payment?.method;
    const total = sale?.totalCents ?? 0; // το πιστωτικό είναι πάντα για όλη την απόδειξη
    rows.push({
      kind: "credit", id: c.id, at: c.createdAt.toISOString(), label: "Πιστωτικό", cents: -total,
      state: c.status === "PENDING" ? "refunding" : "refunded", method: m?.name ?? "", cash: m ? isCash(m) : false,
      card: cardLabel(sale?.payment?.raw), table: null, note: sale ? `για ${label(sale)}` : null,
      mark: terminalFiscal(c.response).mark ?? null, lines: [], pays: [{ cash: m ? isCash(m) : false, cents: -total }],
      refundable: false, creditId: c.status === "PENDING" ? c.id : null,
    });
  }
  for (const x of shares) {
    rows.push({
      kind: "share", id: x.id, at: x.createdAt.toISOString(), label: "Μερίδιο λογαριασμού", cents: x.amountCents,
      state: x.status === "PENDING" ? "pos" : "paid", method: x.method.name, cash: isCash(x.method), card: cardLabel(x.raw),
      table: x.bill.table?.name ?? null, note: x.status === "PAID" ? "Η απόδειξη βγαίνει με το κλείσιμο του λογαριασμού" : null,
      mark: null, lines: [], pays: x.status === "PAID" ? [{ cash: isCash(x.method), cents: x.amountCents }] : [], refundable: false, creditId: null,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
