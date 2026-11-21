// Ανάλυση barcodes εισόδου: EAN-13/GTIN απλό, και GS1-128/DataMatrix με Application Identifiers.
// Υποστηρίζονται τα AI που χρειάζεται η ιχνηλασιμότητα (docs/analysis/PROCUREMENT-DESIGN.md §8, §10):
// (01) GTIN-14, (10) αριθμός παρτίδας, (17) ημερομηνία λήξης, (15) «ανάλωση έως».
// Οι αποκωδικοποιητές παραδίδουν συχνά FNC1 ως \x1D (GS) και prefix symbology "]C1"/"]d2"/"]e0".

export type Gs1Scan = {
  ean?: string; // EAN-13 μονάδας κατανάλωσης — με αυτό γίνεται η αναζήτηση στον κατάλογο (TradeItem.ean)
  gtin?: string; // GTIN-14 όπως σαρώθηκε από AI(01) (indicator ≠ 0 = συσκευασία/κιβώτιο)
  batch?: string; // AI(10)
  expiry?: Date; // AI(17), αλλιώς AI(15) — UTC μεσημέρι για να μην «μετατοπίζει» η ζώνη ώρας
  raw: string;
};

const GS = "\x1D";
const AI_FIXED: Record<string, number> = { "01": 14, "17": 6, "15": 6 };

/** Check digit (mod 10) για σώμα 7/11/12/13 ψηφίων (χωρίς το τελευταίο). */
export const checkDigit = (body: string): number => {
  const digits = body.split("").map(Number);
  const sum = digits.reduceRight((acc, d, i) => acc + d * ((digits.length - i) % 2 === 1 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
};

/** Έλεγχος check digit για GTIN/EAN — δέχεται 8/12/13/14 ψηφία. */
export function validGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/** GTIN-14 με indicator «0» → EAN-13 μονάδας: το check digit ξαναϋπολογίζεται στα 13 ψηφία
 *  (δεν κληρονομείται από το 14ψήφιο), ώστε το κιβώτιο και η μονάδα να καταλήγουν στο ίδιο είδος. */
export function gtinToEan(gtin: string): string | undefined {
  if (!/^\d{14}$/.test(gtin) || gtin[0] !== "0" || !validGtin(gtin)) return undefined;
  const body = gtin.slice(1, 13);
  return body + checkDigit(body);
}

/** GS1 ημερομηνία YYMMDD· «00» ημέρα = τελευταία του μήνα (εθιμικό στα τρόφιμα). */
const yymmdd = (v: string): Date | undefined => {
  const year = 2000 + Number(v.slice(0, 2)); // GS1: 2ψήφιο έτος — για τρόφιμα το 20xx καλύπτει
  const month = Number(v.slice(2, 4));
  const day = v.slice(4, 6) === "00" ? new Date(Date.UTC(year, month, 0)).getUTCDate() : Number(v.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** Αναλύει σκαναρισμένη συμβολοσειρά. Επιστρέφει undefined αν δεν αναγνωρίζεται τίποτα χρήσιμο. */
export function parseGs1(input: string): Gs1Scan | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  let s = raw.replace(/^](C1|d2|e0)/, ""); // prefix αναγνώρισης symbology
  const out: Gs1Scan = { raw };

  // απλό EAN/GTIN χωρίς AI
  if (/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s) && validGtin(s)) {
    if (s.length === 13) out.ean = s;
    else if (s.length === 14) {
      out.gtin = s;
      out.ean = gtinToEan(s); // μόνο με indicator «0»
    } else out.ean = s;
    return out;
  }

  // GS1 με AI: διαδοχικά ζεύγη (AI, τιμή)· το (10) είναι μεταβλητού μήκους και κλείνει με FNC1 ή στο τέλος
  let found = false;
  while (s.length) {
    if (s[0] === GS) { // FNC1 και ως απλός διαχωριστής μετά από σταθερού μήκους AI
      s = s.slice(1);
      continue;
    }
    const ai = s.slice(0, 2);
    if (ai === "10") {
      s = s.slice(2);
      const end = s.indexOf(GS);
      out.batch = (end === -1 ? s : s.slice(0, end)).slice(0, 20);
      s = end === -1 ? "" : s.slice(end + 1);
      found = true;
      continue;
    }
    const len = AI_FIXED[ai];
    if (!len || s.length < 2 + len) break;
    const v = s.slice(2, 2 + len);
    s = s.slice(2 + len);
    if (ai === "01") {
      if (!validGtin(v)) return undefined;
      out.gtin = v;
      out.ean = gtinToEan(v);
    } else {
      const d = yymmdd(v);
      if (d && (ai === "17" || !out.expiry)) out.expiry = d; // η (17) υπερισχύει της (15)
    }
    found = true;
  }
  return found ? out : undefined;
}
