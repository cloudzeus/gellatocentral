// Ενιαίο builder fiscalisationData για ΟΛΟΥΣ τους τύπους παραστατικών (κοινός κορμός).
// Για την ΑΛΠ του ταμείου παράγει το ίδιο αποτέλεσμα με το buildReceipt του lib/viva/fiscal·
// οι υπόλοιποι τύποι προσθέτουν πελάτη (cbCustomer), συσχέτιση και mydataoverride
// (invoiceType, correlatedInvoices, στοιχεία διακίνησης), όπως στα δείγματα της Viva.
// Πηγή: developer.viva.com/viva-fiscalisation/greece/samples.
import { chargeCase, GR, hashAmount, type FiscalLine, type Nature, type PayItem } from "../viva/fiscal.ts";
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

// Γραμμή: είτε ακέραια ποσότητα × τιμή μονάδας, είτε (χονδρική, κιλά) δεκαδική ποσότητα με έτοιμο σύνολο γραμμής.
export type DocLine = FiscalLine & {
  nature?: Nature;
  amountCents?: number; // σύνολο γραμμής με ΦΠΑ, θετικό· όταν δίνεται, η quantity μπορεί να είναι δεκαδική
  vatCents?: number; // ο ΦΠΑ της γραμμής όπως υπολογίστηκε στο παραστατικό (καθαρή × συντελεστής), ώστε τα σύνολα να συμφωνούν
  measurementUnit?: number; // μονάδα myDATA (1 τεμάχια, 2 κιλά, 3 λίτρα): στέλνεται με την ακριβή ποσότητα
};

// Στοιχεία μεταφοράς για 9.3 (και 1.1 που συνοδεύει αγαθά)
export type Dispatch = {
  moment: Date;
  movePurpose: number; // MOVE_PURPOSES (lib/documents/mydata)
  vehicleNumber?: string | null;
  loading: Address;
  delivery: Address;
};
export type Address = { street: string; postalCode: string; city: string };

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildDocument(input: {
  docType: string;
  merchantVat: string;
  series: string;
  aa: number;
  reference: string;
  moment: Date;
  payItem?: PayItem; // κενό = χωρίς εξόφληση· τα τιμολόγια θέλουν ON_CREDIT, το 9.3 καμία
  party?: DocParty;
  relatedReference?: string; // το cbReceiptReference του αρχικού (11.4)
  relatedMark?: string; // το MARK του αρχικού (5.1): correlatedInvoices
  dispatch?: Dispatch;
  lines: DocLine[];
}, type?: DocTypeInfo) {
  // ο τύπος έρχεται από τον κοινό πίνακα (registry)· η στατική λίστα είναι η εφεδρεία (tests, offline)
  const info = type ?? docTypeInfo(input.docType);
  if (info.receiptCase === null) throw new RangeError(`Ο τύπος ${info.code} (${info.title}) δεν εκδίδεται ακόμη: χρειάζεται επαληθευμένο δείγμα από τη Viva`);
  if (info.needsParty && !input.party?.vatNumber) throw new RangeError(`Ο τύπος ${info.code} απαιτεί συναλλασσόμενο με ΑΦΜ`);
  if (info.needsRelated && !input.relatedReference && !input.relatedMark) throw new RangeError(`Ο τύπος ${info.code} είναι συσχετιζόμενος: απαιτείται το αρχικό παραστατικό`);
  if (input.relatedMark && !/^\d{1,19}$/.test(input.relatedMark)) throw new RangeError("Μη έγκυρο MARK αρχικού παραστατικού");
  const delivery = info.code === "9.3";
  if (delivery && !input.dispatch) throw new RangeError("Το δελτίο αποστολής απαιτεί στοιχεία διακίνησης");
  if (input.lines.length === 0) throw new RangeError("Παραστατικό χωρίς γραμμές");

  const moment = iso(input.moment);
  const sign = info.sign;
  // 5.1 όπως στο δείγμα «with MARK»: αρνητικές ποσότητες και σημαία επιστροφής (0x0002) στη γραμμή.
  // Το 11.4 κρατά θετική ποσότητα (επαληθευμένο δείγμα του ταμείου).
  const returnLines = info.code === "5.1";
  const cbChargeItems = input.lines.map((l, i) => {
    const exact = l.amountCents !== undefined;
    if (!(l.quantity > 0) || (!exact && !Number.isInteger(l.quantity))) throw new RangeError("Μη έγκυρη ποσότητα");
    if (exact && (!Number.isInteger(l.amountCents) || l.amountCents! < 0)) throw new RangeError("Μη έγκυρο σύνολο γραμμής");
    // το δελτίο αποστολής δεν έχει αξία: γραμμές «χωρίς ΦΠΑ» (V=8) και ποσό 0
    const amount = delivery ? 0 : sign * (exact ? l.amountCents! : l.quantity * l.unitPriceCents); // με ΦΠΑ
    const quantity = Math.round(l.quantity * 100) * (returnLines ? -1 : 1); // η Viva θέλει ποσότητα ×100
    const vatRate = delivery ? 0 : l.vatRate;
    const ftChargeItemCase = delivery ? GR + 0x8n : chargeCase(l.vatRate, l.nature) + (returnLines ? 0x2_0000n : 0n);
    const exactQuantity = l.measurementUnit !== undefined && (exact || delivery);
    return {
      position: i + 1,
      description: l.name,
      quantity,
      amount,
      vatRate: vatRate * 100,
      vatAmount: delivery ? 0 : l.vatCents !== undefined ? sign * l.vatCents : Math.round((amount * vatRate) / (100 + vatRate)),
      ftChargeItemCase,
      currencyCode: "978",
      moment,
      // το override πάει αυτούσιο στην ΑΑΔΕ, που θέλει πάντα θετική ποσότητα (και στο 5.1)· το πρόσημο μένει στο quantity της Viva
      ...(exactQuantity ? { ftChargeItemCaseData: { GR: { mydataoverride: { invoiceDetails: { quantity: Number(l.quantity.toFixed(3)), measurementUnit: l.measurementUnit } } } } } : {}),
    };
  });
  const total = cbChargeItems.reduce((s, c) => s + c.amount, 0);
  const p = input.party;
  const d = input.dispatch;
  const address = (a: Address) => ({ street: a.street, number: "0", postalCode: a.postalCode, city: a.city });
  // Η ΑΛΠ είναι ο εξ ορισμού τύπος της Viva· οι υπόλοιποι δηλώνονται ρητά (το 9.3 το βγάζει ο ftReceiptCase).
  const header = {
    ...(info.code !== "11.1" && !delivery ? { invoiceType: info.code } : {}),
    ...(input.relatedMark ? { correlatedInvoices: [BigInt(input.relatedMark)] } : {}),
    ...(d ? {
      dispatchDate: iso(d.moment), dispatchTime: iso(d.moment), movePurpose: d.movePurpose,
      ...(d.vehicleNumber ? { vehicleNumber: d.vehicleNumber } : {}),
      withoutDigitalTransportTracking: true,
      otherDeliveryNoteHeader: { startShippingBranch: 0, completeShippingBranch: 0, loadingAddress: address(d.loading), deliveryAddress: address(d.delivery) },
    } : {}),
  };
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
          ...(Object.keys(header).length ? { mydataoverride: { invoice: { invoiceHeader: header } } } : {}),
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
      cbPayItems: input.payItem && !delivery
        ? [{ position: 1, description: input.payItem.description, amount: total, ftPayItemCase: GR + BigInt(input.payItem.payItemCase), currencyCode: "978", moment, ...(input.payItem.transactionId ? { transactionId: input.payItem.transactionId } : {}) }]
        : [],
    },
  };
}
