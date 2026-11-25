// Καθαρά οικονομικά aggregates· POS και χονδρική δεν συγχωνεύονται στις ταμειακές κινήσεις.
import { sumDocumentTotals } from "./procurement.ts";

export function purchaseTotals(document: { shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number }, lines: readonly { quantity: number; unitPriceCents: number; discountBps: number; vatRate: number }[]) {
  const lineTotals = sumDocumentTotals(lines.map((line) => ({ quantityBase: line.quantity, unitPriceCents: line.unitPriceCents, discountBps: line.discountBps, vatRate: line.vatRate })));
  const expensesNet = document.shippingCostCents + document.otherExpensesCents;
  const expensesVat = Math.round(expensesNet * document.expensesVatRate / 100);
  return { netCents: lineTotals.netCents + expensesNet, vatCents: lineTotals.vatCents + expensesVat, totalCents: lineTotals.totalCents + expensesNet + expensesVat };
}

export function expectedCashCents(openingCashCents: number, cashSalesCents: number, payoutsCents: number) {
  if (![openingCashCents, cashSalesCents, payoutsCents].every(Number.isSafeInteger) || cashSalesCents < 0 || payoutsCents < 0) throw new Error("Άκυρα ποσά ταμείου");
  return openingCashCents + cashSalesCents - payoutsCents;
}

export function athensBusinessRange(businessDate: Date) {
  if (Number.isNaN(businessDate.getTime())) throw new Error("Άκυρη ημερομηνία ταμείου");
  const day = businessDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { fromAt: athensMidnight(day), toAt: athensMidnight(next.toISOString().slice(0, 10)) };
}

function athensMidnight(day: string) {
  const target = Date.parse(`${day}T00:00:00.000Z`);
  let result = new Date(target);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const wall = result.toLocaleString("sv-SE", { timeZone: "Europe/Athens" }).replace(" ", "T");
    const offset = Date.parse(`${wall}.000Z`) - result.getTime();
    result = new Date(target - offset);
  }
  return result;
}

export function paymentBucket(method: { code: string; ledgerKind: string }) {
  if (method.ledgerKind === "CREDIT") return "credit" as const;
  if (method.ledgerKind === "CASH") return "cash" as const;
  if (/wolt|efood|delivery|platform|online/i.test(method.code)) return "platform" as const;
  return "card" as const;
}
