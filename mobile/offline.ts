// Ταμείο χωρίς σύνδεση με τον server: η απόδειξη χτίζεται εδώ με το ίδιο buildReceipt του server (web/lib/viva/fiscal.ts),
// με τη σειρά της συσκευής και δικό της ΑΑ, και πηγαίνει στο Viva Terminal όπως πάντα. Το Viva Terminal υπογράφει και
// διαβιβάζει (χωρίς internet την κρατά και την ξαναστέλνει μόνο του). Η πώληση μπαίνει σε ουρά και ανεβαίνει στον
// server όταν γυρίσει η σύνδεση (POST /api/pos/sales/offline), όπου η Viva βεβαιώνει την πληρωμή πριν καταγραφεί.
import { buildReceipt, toVivaJson } from "../web/lib/viva/fiscal.ts";

export type OfflineCtx = { merchantVat: string; series: string; nextAa: number };
export type OfflineLine = { productId: string; name: string; quantity: number; unitPriceCents: number; vatRate: number; options: { name: string; priceCents: number }[]; note?: string };
export type OfflineSale = { saleId: string; reference: string; aa: number; issuedAt: string; methodId: string; amountCents: number; transactionId?: string; lines: OfflineLine[] };
/** Στην ουρά: rejected = ο server αρνήθηκε (π.χ. η Viva δεν βρήκε πληρωμή)· θέλει τον υπεύθυνο, δεν ξαναστέλνεται. */
export type Queued = OfflineSale & { rejected?: string };
export type Outbox = { lastAa: number; sales: Queued[] };

/** Ίδιο κείμενο γραμμής με τον server (web/lib/pos-modifiers.ts lineDescription): μπαίνει στην υπογραφή. */
export function lineDescription(line: { name: string; options?: { name: string }[]; note?: string | null }) {
  const parts = [...(line.options ?? []).map((o) => o.name), ...(line.note ? [line.note] : [])];
  return parts.length ? `${line.name} · ${parts.join(", ")}` : line.name;
}

// shortcut: UUID με Math.random (το Hermes δεν έχει crypto.randomUUID)· αρκεί για μοναδικό reference ανά συσκευή
export function uuid(random = Math.random) {
  const h = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const base64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Ο επόμενος ΑΑ: μετά τον τελευταίο που έβγαλε η συσκευή χωρίς σύνδεση ή όσο λέει ο server, ό,τι είναι μεγαλύτερο. */
export const nextAa = (ctx: OfflineCtx, outbox: Outbox) => Math.max(ctx.nextAa, outbox.lastAa + 1);

export function offlineSale(ctx: OfflineCtx, outbox: Outbox, method: { id: string; name: string; payItemCase: number }, lines: OfflineLine[], now = new Date(), random = Math.random) {
  const reference = uuid(random);
  const aa = nextAa(ctx, outbox);
  const moment = new Date(Math.floor(now.getTime() / 1000) * 1000); // η Viva θέλει δευτερόλεπτα· ίδιο ακριβώς στον server
  const receipt = buildReceipt({
    merchantVat: ctx.merchantVat, series: ctx.series, aa, reference, moment, payItem: { description: method.name, payItemCase: method.payItemCase },
    lines: lines.map((l) => ({ name: lineDescription(l), quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate })),
  });
  const sale: OfflineSale = { saleId: `off_${reference.replace(/-/g, "")}`, reference, aa, issuedAt: moment.toISOString(), methodId: method.id, amountCents: receipt.totalCents, lines };
  return { sale, fiscalisationData: base64url(toVivaJson(receipt.data)) };
}

/** Πληρώθηκε στο Viva Terminal: μπαίνει στην ουρά και ο ΑΑ θεωρείται πια δεσμευμένος. */
export const enqueue = (outbox: Outbox, sale: OfflineSale): Outbox => ({ lastAa: Math.max(outbox.lastAa, sale.aa), sales: [...outbox.sales, sale] });
