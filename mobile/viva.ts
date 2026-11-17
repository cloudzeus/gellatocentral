// Πληρωμή μέσω της εφαρμογής «Viva.com Terminal» στην ίδια συσκευή (inter-app).
// Πηγή: developer.viva.com/apis-for-point-of-sale/card-terminal-apps/android-app/sale
// ΔΕΝ έχει δοκιμαστεί ακόμα σε πραγματική συσκευή με το Viva Terminal (demo).
const CALLBACK = "gelatosystem://viva-result";

export function saleUrl(input: { saleId: string; amountCents: number; fiscalisationData: string }) {
  const q = new URLSearchParams({
    appId: "app.gelatosystem.pos",
    action: "sale",
    clientTransactionId: input.saleId,
    amount: String(input.amountCents),
    callback: CALLBACK,
    show_receipt: "false", // την απόδειξη την τυπώνουμε εμείς
    show_transaction_result: "true",
    fiscalisationData: input.fiscalisationData, // Base64URL, έτοιμο από τον server
  });
  return `vivapayclient://pay/v1?${q}`;
}

export const isVivaResult = (url: string) => url.startsWith(CALLBACK);

/** Το Viva Terminal επιστρέφει `status=success|fail` και στοιχεία συναλλαγής στο callback URI. */
export function parseResult(url: string) {
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  return { success: q.get("status") === "success", transactionId: q.get("transactionId") ?? undefined, clientTransactionId: q.get("clientTransactionId") };
}
