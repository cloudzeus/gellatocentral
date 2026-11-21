// Ενιαίο builder fiscalisationData για ΟΛΟΥΣ τους τύπους παραστατικών (κοινός κορμός).
// Για την ΑΛΠ του ταμείου παράγει το ίδιο αποτέλεσμα με το buildReceipt του lib/viva/fiscal·
// οι υπόλοιποι τύποι προσθέτουν πελάτη (cbCustomer), συσχέτιση (cbPreviousReceiptReference)
// και mydataoverride.invoice.invoiceHeader.invoiceType, όπως στα δείγματα της Viva.
// Πηγή: developer.viva.com/viva-fiscalisation/greece/samples.
import { chargeCase, GR, hashAmount, type FiscalLine, type PayItem } from "../viva/fiscal.ts";
import { docTypeInfo, type DocTypeInfo } from "./types.ts";

// Στοιχεία αντισυμβαλλόμενου όπως τα θέλει το cbCustomer της Viva.
export type DocParty = {
  vatNumber: string;
  name: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string; // ISO alpha-2, προεπιλογή GR
};

export function buildDocument(input: {
  docType: string;
  merchantVat: string;
  series: string;
  aa: number;
  reference: string;
  moment: Date;
  payItem?: PayItem; // κενό = χωρίς εξόφληση (επί πιστώσει): δεν στέλνονται cbPayItems
  party?: DocParty;
  relatedReference?: string; // το cbReceiptReference του αρχικού, για συσχετιζόμενα πιστωτικά
  lines: FiscalLine[];
}, type?: DocTypeInfo) {
  // ο τύπος έρχεται από τον κοινό πίνακα (registry)· η στατική λίστα είναι η εφεδρεία (tests, offline)
  const info = type ?? docTypeInfo(input.docType);
  if (info.receiptCase === null) throw new RangeError(`Ο τύπος ${info.code} (${info.title}) δεν εκδίδεται ακόμη: χρειάζεται επαληθευμένο δείγμα από τη Viva`);
  if (info.needsParty && !input.party?.vatNumber) throw new RangeError(`Ο τύπος ${info.code} απαιτεί συναλλασσόμενο με ΑΦΜ`);
  if (info.needsRelated && !input.relatedReference) throw new RangeError(`Ο τύπος ${info.code} είναι συσχετιζόμενος: απαιτείται το αρχικό παραστατικό`);
  if (input.lines.length === 0) throw new RangeError("Παραστατικό χωρίς γραμμές");

  const moment = input.moment.toISOString().replace(/\.\d{3}Z$/, "Z");
  const sign = info.sign;
  const cbChargeItems = input.lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError("Μη έγκυρη ποσότητα");
    const amount = sign * l.quantity * l.unitPriceCents; // με ΦΠΑ· αρνητικό στα πιστωτικά
    return {
      position: i + 1,
      description: l.name,
      quantity: l.quantity * 100, // η Viva θέλει ποσότητα ×100, πάντα θετική
      amount,
      vatRate: l.vatRate * 100,
      vatAmount: Math.round((amount * l.vatRate) / (100 + l.vatRate)),
      ftChargeItemCase: chargeCase(l.vatRate),
      currencyCode: "978",
      moment,
    };
  });
  const total = cbChargeItems.reduce((s, c) => s + c.amount, 0);
  const p = input.party;
  return {
    totalCents: total,
    data: {
      ftReceiptCase: info.receiptCase,
      ftReceiptCaseData: {
        GR: {
          MerchantVATID: input.merchantVat,
          Series: input.series,
          AA: input.aa,
          HashAlg: "sha256",
          HashPayload: [input.merchantVat, input.series, input.aa, input.reference, moment, hashAmount(total)].join("-"),
          // Η ΑΛΠ είναι ο εξ ορισμού τύπος της Viva· οι υπόλοιποι δηλώνονται ρητά.
          ...(info.code !== "11.1" ? { mydataoverride: { invoice: { invoiceHeader: { invoiceType: info.code } } } } : {}),
        },
      },
      cbReceiptReference: input.reference,
      ...(input.relatedReference ? { cbPreviousReceiptReference: input.relatedReference } : {}),
      cbReceiptMoment: moment,
      cbReceiptAmount: total,
      currencyCode: "978",
      cbChargeItems,
      ...(p
        ? {
            cbCustomer: {
              customerVATId: p.vatNumber,
              customerName: p.name,
              customerStreet: p.street ?? "",
              customerZip: p.zip ?? "",
              customerCity: p.city ?? "",
              customerCountry: p.country ?? "GR",
            },
          }
        : {}),
      cbPayItems: input.payItem
        ? [{ position: 1, description: input.payItem.description, amount: total, ftPayItemCase: GR + BigInt(input.payItem.payItemCase), currencyCode: "978", moment }]
        : [],
    },
  };
}
