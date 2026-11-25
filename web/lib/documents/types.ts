// Κανονικός κατάλογος τύπων παραστατικών myDATA που καλύπτει η εφαρμογή — κοινός για POS,
// τιμολόγηση συνδρομών και χονδρική. Ο κάθε τύπος δηλώνει εδώ τους κανόνες του και το UI/API
// ζητά απλώς «έκδοση τύπου Χ».
// Πηγές: Α.1138/2020 (τύποι και είδη παραστατικών) και developer.viva.com/viva-fiscalisation/
// greece/samples (ftReceiptCase ανά τύπο).
// receiptCase = null: ο τύπος είναι δηλωμένος αλλά ΔΕΝ εκδίδεται ακόμη — χρειάζεται
// επαληθευμένο δείγμα από το demo της Viva πριν ενεργοποιηθεί (το buildDocument αρνείται).

// 0x4752_2000_0000_0000 — «GR» + έκδοση 2000, όπως στο lib/viva/fiscal.
const GR = 0x4752_2000_0000_0000n;

export type DocTypeInfo = {
  code: string; // κωδικός myDATA, π.χ. "11.1"
  title: string; // ελληνικός τίτλος για UI και εκτυπώσεις
  sign: 1 | -1; // χρεωστικό (+1) / πιστωτικό (−1): τα ποσά στέλνονται με αυτό το πρόσημο
  retail: boolean; // 11.x — μη αντικριζόμενο λιανικής
  needsParty: boolean; // απαιτεί συναλλασσόμενο (ΑΦΜ) — αντικριζόμενα και απλοποιημένο
  needsRelated: boolean; // συσχετιζόμενο πιστωτικό: απαιτεί το αρχικό παραστατικό
  receiptCase: bigint | null; // ftReceiptCase της Viva· null = δεν εκδίδεται ακόμη
};

export const DOC_TYPES: Record<string, DocTypeInfo> = {
  "11.1": { code: "11.1", title: "Απόδειξη Λιανικής Πώλησης", sign: 1, retail: true, needsParty: false, needsRelated: false, receiptCase: GR + 0x1n },
  "11.2": { code: "11.2", title: "Απόδειξη Παροχής Υπηρεσιών", sign: 1, retail: true, needsParty: false, needsRelated: false, receiptCase: null },
  "11.3": { code: "11.3", title: "Απλοποιημένο Τιμολόγιο", sign: 1, retail: true, needsParty: true, needsRelated: false, receiptCase: null },
  // Δείγμα «11.4 / INVOICE_RETURN_RELATED»: 5139205309239132161 = GR + 0x5000001, αρνητικά ποσά + cbPreviousReceiptReference.
  "11.4": { code: "11.4", title: "Πιστωτικό Στοιχείο Λιανικής", sign: -1, retail: true, needsParty: false, needsRelated: true, receiptCase: GR + 0x5000001n },
  // Τιμολόγια: 0x0008_1002 (Invoice + δική μας αρίθμηση)· ο τύπος myDATA δηλώνεται στο mydataoverride.
  // Το 2.1 επαληθεύτηκε στο demo της Viva στις 2026-11-25.
  "1.1": { code: "1.1", title: "Τιμολόγιο Πώλησης", sign: 1, retail: false, needsParty: true, needsRelated: false, receiptCase: GR + 0x0008_1002n },
  "1.2": { code: "1.2", title: "Τιμολόγιο Πώλησης / Ενδοκοινοτικές Παραδόσεις", sign: 1, retail: false, needsParty: true, needsRelated: false, receiptCase: null },
  "2.1": { code: "2.1", title: "Τιμολόγιο Παροχής Υπηρεσιών", sign: 1, retail: false, needsParty: true, needsRelated: false, receiptCase: GR + 0x0008_1002n },
  // 5.1 «with MARK»: + επιστροφή (0x0100)· η συσχέτιση γίνεται με το MARK του αρχικού (correlatedInvoices)
  "5.1": { code: "5.1", title: "Πιστωτικό Τιμολόγιο / Συσχετιζόμενο", sign: -1, retail: false, needsParty: true, needsRelated: true, receiptCase: GR + 0x0108_1002n },
  "5.2": { code: "5.2", title: "Πιστωτικό Τιμολόγιο / Μη Συσχετιζόμενο", sign: -1, retail: false, needsParty: true, needsRelated: false, receiptCase: null },
  // 9.3 αυτόνομο: τύπος 0x0005 + στοιχεία μεταφοράς (0x0400) + δική μας αρίθμηση· γραμμές μηδενικής αξίας
  "9.3": { code: "9.3", title: "Δελτίο Αποστολής", sign: 1, retail: false, needsParty: true, needsRelated: false, receiptCase: GR + 0x0408_0005n },
};

/** Τα μεταξύ τύπου και κανόνων· άγνωστος τύπος = σφάλμα, ποτέ σιωπηρή αποδοχή. */
export function docTypeInfo(code: string): DocTypeInfo {
  const info = DOC_TYPES[code];
  if (!info) throw new RangeError(`Άγνωστος τύπος παραστατικού: ${code}`);
  return info;
}
