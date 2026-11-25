// Χτίζει το αντικείμενο `fiscalisationData` του Viva Fiscalisation για απόδειξη λιανικής (11.1).
// Πηγή: developer.viva.com/viva-fiscalisation (core, receiptcase, payitemcase, chargeitemcase, greece/samples).
// Η Viva υπογράφει και διαβιβάζει στο myDATA· εμείς ΔΕΝ στέλνουμε ξεχωριστά παραμέτρους ΑΑΔΕ.

// 0x4752_2000_0000_0000 — «GR» + έκδοση 2000. Τα ft…Case στέλνονται ως δεκαδικό Int64,
// γι' αυτό BigInt: ξεπερνούν το Number.MAX_SAFE_INTEGER.
export const GR = 0x4752_2000_0000_0000n;
const RECEIPT_POS = GR + 0x0001n; // απόδειξη λιανικής POS
// Το τελευταίο byte του ftPayItemCase (0x01 μετρητά, 0x05 κάρτα…) δεν είναι πλέον hardcoded:
// αποθηκεύεται ανά τρόπο πληρωμής (PaymentMethod.payItemCase) και έρχεται εδώ έτοιμο.

// Τελευταίο ψηφίο του ftChargeItemCase = κατηγορία ΦΠΑ, προτελευταίο (S) = φύση της γραμμής, από την οποία
// η Viva βγάζει τον χαρακτηρισμό εσόδου: 1 εμπόρευμα (category1_1), 5 προϊόν δικής παραγωγής (category1_2),
// 2 υπηρεσία (category1_3). 24% → 3 (κανονικός), 13/6/17/9% → 1 (μειωμένος· το ποσοστό το δίνει το vatRate), 4% → 4, 0% → 7.
// shortcut: απαλλαγές ΦΠΑ (NN ≠ 00) δεν υποστηρίζονται· θέλουν λόγο απαλλαγής ανά γραμμή όταν χρειαστεί.
export type Nature = "GOODS" | "PRODUCT" | "SERVICE";
const SERVICE_NIBBLE: Record<Nature, bigint> = { GOODS: 0x10n, PRODUCT: 0x50n, SERVICE: 0x20n };
export function chargeCase(vatRate: number, nature: Nature = "GOODS"): bigint {
  const v = vatRate === 24 ? 3n : vatRate === 4 ? 4n : vatRate === 0 ? 7n : [13, 6, 17, 9].includes(vatRate) ? 1n : null;
  if (v === null) throw new RangeError(`Μη υποστηριζόμενος συντελεστής ΦΠΑ: ${vatRate}%`);
  return GR + SERVICE_NIBBLE[nature] + v;
}

// Ποσό στο HashPayload: δεκαδικό με τελεία, δύο δεκαδικά εκτός αν το δεύτερο είναι 0 (12.40 → 12.4, 12.00 → 12.0).
export function hashAmount(cents: number): string {
  const s = (cents / 100).toFixed(2);
  return s.endsWith("0") ? s.slice(0, -1) : s;
}

export type FiscalLine = { name: string; quantity: number; unitPriceCents: number; vatRate: number };
// Πώς πληρώθηκε η απόδειξη: η ετικέτα και το φορολογικό case του τρόπου πληρωμής (από το PaymentMethod).
// transactionId: η συναλλαγή κάρτας της Viva — χωρίς αυτήν η ΑΑΔΕ απορρίπτει την πληρωμή με κάρτα εκτός ταμείου.
export type PayItem = { description: string; payItemCase: number; transactionId?: string };
// Επί πιστώσει (0x09): τιμολόγιο που εξοφλείται αργότερα
export const ON_CREDIT: PayItem = { description: "Επί πιστώσει", payItemCase: 0x09 };

export function buildReceipt(input: {
  merchantVat: string;
  series: string;
  aa: number;
  reference: string;
  moment: Date;
  payItem: PayItem;
  lines: FiscalLine[];
}) {
  if (input.lines.length === 0) throw new RangeError("Απόδειξη χωρίς γραμμές");
  const moment = input.moment.toISOString().replace(/\.\d{3}Z$/, "Z");
  const cbChargeItems = input.lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError("Μη έγκυρη ποσότητα");
    const amount = l.quantity * l.unitPriceCents; // με ΦΠΑ
    return {
      position: i + 1,
      description: l.name,
      quantity: l.quantity * 100, // η Viva θέλει ποσότητα ×100
      amount,
      vatRate: l.vatRate * 100,
      vatAmount: Math.round((amount * l.vatRate) / (100 + l.vatRate)),
      ftChargeItemCase: chargeCase(l.vatRate),
      currencyCode: "978",
      moment,
    };
  });
  const total = cbChargeItems.reduce((s, c) => s + c.amount, 0);
  return {
    totalCents: total,
    data: {
      ftReceiptCase: RECEIPT_POS,
      ftReceiptCaseData: {
        GR: {
          MerchantVATID: input.merchantVat,
          Series: input.series,
          AA: input.aa,
          HashAlg: "sha256",
          HashPayload: [input.merchantVat, input.series, input.aa, input.reference, moment, hashAmount(total)].join("-"),
        },
      },
      cbReceiptReference: input.reference,
      cbReceiptMoment: moment,
      cbReceiptAmount: total,
      currencyCode: "978",
      cbChargeItems,
      cbPayItems: [
        {
          position: 1,
          description: input.payItem.description,
          amount: total,
          ftPayItemCase: GR + BigInt(input.payItem.payItemCase),
          currencyCode: "978",
          moment,
        },
      ],
    },
  };
}

// Τα BigInt πρέπει να φύγουν ως γυμνοί αριθμοί (όχι strings, όχι στρογγυλεμένα).
// JSON.rawJSON: Node 22+.
const rawJSON = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON; // λείπει ακόμα από τους τύπους της TypeScript
export const toVivaJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? rawJSON(v.toString()) : v));
