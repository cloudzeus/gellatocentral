// Σάρωση τιμολογίου αγοράς (OCR) με μοντέλο όρασης μέσω OpenRouter — pay-per-use υπηρεσία (§10).
// Εδώ μόνο οι ΚΑΘΑΡΕΣ συναρτήσεις (ανάλυση απάντησης μοντέλου, χρέωση) — δοκιμάζονται με node --test.
// Η ορχήστρωση (δίκτυο + βάση + UsageEvent) είναι στο ocr-scan.ts.
// Χρέωση: πραγματικό κόστος OpenRouter (USD) → ευρώ (ισοτιμία πλατφόρμας) → + markup της UsagePrice.

export class OcrError extends Error {}

// ---- Καθαρές συναρτήσεις (δοκιμάζονται χωρίς βάση/δίκτυο) ----

export type OcrLine = {
  description: string;
  quantity: number; // μονάδες παραστατικού (π.χ. κιβώτια)
  unitPriceCents: number; // προ έκπτωσης και ΦΠΑ, ανά μονάδα παραστατικού, σε λεπτά
  discountBps: number;
  vatRate: number;
  supplierCode: string | null;
  ean: string | null;
  batchNumber: string | null;
  expiresAt: Date | null;
};

export type OcrInvoice = {
  number: string | null;
  issuedAt: Date | null;
  vatNumber: string | null; // ΑΦΜ εκδότη — βοηθά την επιλογή/έλεγχο προμηθευτή
  mydataMark: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  shippingMethod: string | null;
  shippingAddress: string | null;
  shippingCostCents: number;
  otherExpensesCents: number;
  expensesVatRate: number;
  lines: OcrLine[];
};

const str = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};
const date = (v: unknown): Date | null => {
  const m = str(v, 10)?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[0]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Μετατρέπει την απάντηση του μοντέλου σε καθαρή δομή. Πετά σάπιες γραμμές· χωρίς έγκυρη γραμμή = αποτυχία. */
export function parseInvoiceJson(raw: string): OcrInvoice {
  // το μοντέλο συχνά τυλίγει σε ```json …``` ή προσθέτει πρόλογο — κρατάμε το εξώτερο {…}
  const text = raw.replace(/```[a-z]*/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new OcrError("Το μοντέλο δεν επέστρεψε δομημένα δεδομένα");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new OcrError("Το μοντέλο δεν επέστρεψε έγκυρο JSON");
  }
  const rawLines = Array.isArray(j.lines) ? j.lines : [];
  const lines: OcrLine[] = [];
  const money = (value: unknown) => {
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000 ? cents : 0;
  };
  const rate = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 0;
  };
  for (const l of rawLines) {
    if (typeof l !== "object" || !l) continue;
    const o = l as Record<string, unknown>;
    const description = str(o.description, 120);
    const quantity = Number(o.quantity);
    const unitPriceCents = Math.round(Number(o.unitPrice) * 100);
    const discountBps = Math.round(Number(o.discountPercent ?? 0) * 100);
    if (!description || description.length < 2) continue;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) continue; // η ποσότητα του παραστατικού είναι ακέραια — κλασματική σημαίνει λάθος ανάγνωση
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > 100_000_000) continue;
    const eanRaw = str(o.ean, 20)?.replace(/\D/g, "") ?? null;
    lines.push({
      description,
      quantity,
      unitPriceCents,
      discountBps: Number.isSafeInteger(discountBps) && discountBps >= 0 && discountBps <= 10_000 ? discountBps : 0,
      vatRate: rate(o.vatRate),
      supplierCode: str(o.supplierCode, 40),
      ean: eanRaw && eanRaw.length >= 8 && eanRaw.length <= 14 ? eanRaw : null,
      batchNumber: str(o.batchNumber, 20),
      expiresAt: date(o.expiresAt),
    });
  }
  if (!lines.length) throw new OcrError("Δεν αναγνωρίστηκε καμία γραμμή ειδών — ξαναδοκίμασε με πιο καθαρή φωτογραφία");
  const vatRaw = str(j.vatNumber, 12)?.replace(/\D/g, "") ?? null;
  const mark = str(j.mydataMark, 40)?.replace(/\D/g, "") ?? null;
  return {
    number: str(j.number, 40), issuedAt: date(j.issuedAt), vatNumber: vatRaw?.length === 9 ? vatRaw : null,
    mydataMark: mark && mark.length >= 10 ? mark : null,
    paymentMethod: str(j.paymentMethod, 120), paymentTerms: str(j.paymentTerms, 120),
    shippingMethod: str(j.shippingMethod, 120), shippingAddress: str(j.shippingAddress, 300),
    shippingCostCents: money(j.shippingCost), otherExpensesCents: money(j.otherExpenses), expensesVatRate: rate(j.expensesVatRate ?? 24), lines,
  };
}

/** Χρέωση συνδρομητή σε λεπτά EUR: κόστος USD × ισοτιμία × (1 + markup). */
export const chargeCents = (costUsd: number, usdEurRate: number, markupPercent: number): number =>
  Math.max(0, Math.round(costUsd * usdEurRate * (1 + markupPercent / 100) * 100));

// ---- Το prompt του μοντέλου όρασης (το καλεί το ocr-scan.ts) ----

export const OCR_SYSTEM =
  "Είσαι εξειδικευμένος αναγνώστης ελληνικών τιμολογίων αγοράς χονδρικής (Τιμολόγιο Αγοράς / Δελτίο Αποστολής-Τιμολόγιο). " +
  "Εξάγεις τα στοιχεία του παραστατικού σε αυστηρό JSON και τίποτα άλλο.";
export const OCR_PROMPT = `Διάβασε το τιμολόγιο της φωτογραφίας και επέστρεψε ΜΟΝΟ JSON αυτής της μορφής:
{"number": <αριθμός παραστατικού ή null>, "issuedAt": <"YYYY-MM-DD" ή null>, "vatNumber": <ΑΦΜ εκδότη, 9 ψηφία, ή null>,
 "mydataMark": <ΜΑΡΚ αν τυπώνεται, αλλιώς null>, "paymentMethod": <τρόπος πληρωμής ή null>, "paymentTerms": <όροι πληρωμής ή null>,
 "shippingMethod": <τρόπος αποστολής/μεταφορέας ή null>, "shippingAddress": <διεύθυνση παράδοσης ή null>,
 "shippingCost": <καθαρά μεταφορικά προ ΦΠΑ ή 0>, "otherExpenses": <λοιπά καθαρά έξοδα προ ΦΠΑ ή 0>, "expensesVatRate": <ΦΠΑ εξόδων, π.χ. 24>,
 "lines": [{"description": <περιγραφή είδους όπως τυπώνεται>, "quantity": <ακέραιη ποσότητα στη μονάδα παραστατικού, π.χ. κιβώτια>,
 "unitPrice": <αρχική τιμή μονάδας ΠΡΟ εκπτώσεως και ΦΠΑ σε ευρώ>, "discountPercent": <ποσοστό έκπτωσης γραμμής, π.χ. 12.5 ή 0>, "vatRate": <ποσοστό ΦΠΑ γραμμής, π.χ. 13>,
 "supplierCode": <κωδικός είδους του προμηθευτή ή null>, "ean": <barcode/EAN αν τυπώνεται, αλλιώς null>,
 "batchNumber": <παρτίδα αν τυπώνεται, αλλιώς null>, "expiresAt": <"YYYY-MM-DD" ημερομηνία λήξης αν τυπώνεται, αλλιώς null>}]}
Κανόνες: η unitPrice είναι πριν από την έκπτωση και το ΦΠΑ. Η discountPercent και η vatRate γράφονται ως ποσοστά, όχι δεκαδικός συντελεστής.
Μην βάζεις γραμμές συνόλων, ΦΠΑ ή μεταφορικών ως είδη. Αγνοείς σχόλια και υποστηρικτικά κείμενα. Μην εφευρίσκεις τιμές που δεν διαβάζονται.`;
