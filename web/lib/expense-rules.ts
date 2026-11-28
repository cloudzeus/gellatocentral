// Τύποι εξόδων και χαρακτηρισμοί myDATA χωρίς βάση (ενότητα 6): επιτρεπτοί συνδυασμοί της ΑΑΔΕ, περιγραφές,
// προεπιλογές demo και μοιρασιά δαπάνης περιόδου στους μήνες. Οι συνδυασμοί έρχονται από το επίσημο xlsx
// (scripts/import-mydata-combos.mjs → mydata-combos.json).
import combosFile from "./mydata-combos.json" with { type: "json" };
import { allocateCents } from "./reports.ts";

export class ExpenseRuleError extends Error {}

type Combos = Record<string, { EXPENSE?: Record<string, string[]>; INCOME?: Record<string, string[]> }>;
const COMBOS = combosFile.combos as Combos;
export const COMBOS_VERSION = combosFile.version;

export const KINDS = ["COGS", "OPEX", "PAYROLL_COST", "ASSET", "FINANCE", "TAX_FEE", "OTHER"] as const;
export const KIND_LABEL: Record<string, string> = {
  COGS: "Κόστος πωληθέντων", OPEX: "Λειτουργικά", PAYROLL_COST: "Κόστος προσωπικού", ASSET: "Πάγια", FINANCE: "Χρηματοοικονομικά", TAX_FEE: "Φόροι και τέλη", OTHER: "Λοιπά",
};

/** Οι τύποι παραστατικού προμηθευτή που βλέπει μια επιχείρηση εστίασης· οι υπόλοιποι γίνονται δεκτοί αν υπάρχουν στο xlsx. */
export const DOC_TYPES: Record<string, string> = {
  "1.1": "Τιμολόγιο πώλησης", "2.1": "Τιμολόγιο παροχής υπηρεσιών", "13.1": "Αγορές λιανικής", "13.2": "Παροχή λιανικής",
  "14.3": "Λήψη υπηρεσιών από ΕΕ", "14.4": "Λήψη υπηρεσιών από τρίτες χώρες", "14.30": "Λογαριασμός χωρίς MARK (π.χ. ρεύμα)", "16.1": "Ενοίκια", "17.1": "Μισθοδοσία",
};

export const CATEGORY_LABEL: Record<string, string> = {
  category2_1: "Αγορές εμπορευμάτων", category2_2: "Αγορές πρώτων υλών και υλικών", category2_3: "Λήψη υπηρεσιών",
  category2_4: "Γενικά έξοδα με έκπτωση ΦΠΑ", category2_5: "Γενικά έξοδα χωρίς έκπτωση ΦΠΑ", category2_6: "Αμοιβές και παροχές προσωπικού",
  category2_7: "Αγορές παγίων", category2_8: "Αποσβέσεις παγίων", category2_9: "Έξοδα για λογαριασμό τρίτων",
  category2_10: "Έξοδα προηγούμενων χρήσεων", category2_11: "Έξοδα επόμενων χρήσεων", category2_12: "Λοιπές εγγραφές τακτοποίησης εξόδων",
};

export const E3_LABEL: Record<string, string> = {
  E3_102_001: "Αγορές εμπορευμάτων, χονδρικές", E3_102_002: "Αγορές εμπορευμάτων, λιανικές", E3_102_003: "Αγορές εμπορευμάτων, άρθρο 39α ΦΠΑ",
  E3_102_004: "Αγορές εμπορευμάτων από ΕΕ", E3_102_005: "Αγορές εμπορευμάτων από τρίτες χώρες", E3_102_006: "Αγορές εμπορευμάτων, λοιπά",
  E3_202_001: "Αγορές πρώτων υλών, χονδρικές", E3_202_002: "Αγορές πρώτων υλών, λιανικές", E3_202_003: "Αγορές πρώτων υλών από ΕΕ",
  E3_202_004: "Αγορές πρώτων υλών από τρίτες χώρες", E3_202_005: "Αγορές πρώτων υλών, λοιπά",
  E3_581_001: "Μικτές αποδοχές", E3_581_002: "Εργοδοτικές εισφορές", E3_581_003: "Λοιπές παροχές σε εργαζόμενους",
  E3_585_001: "Προμήθειες διαχείρισης", E3_585_002: "Δαπάνες από συνδεδεμένες επιχειρήσεις", E3_585_004: "Δαπάνες για ενημερωτικές ημερίδες",
  E3_585_005: "Έξοδα υποδοχής και φιλοξενίας", E3_585_006: "Έξοδα ταξιδιών", E3_585_008: "Έξοδα παραγγελιοδόχου για αγρότες",
  E3_585_009: "Αμοιβές για υπηρεσίες ημεδαπής", E3_585_010: "Αμοιβές για υπηρεσίες αλλοδαπής", E3_585_011: "Ενέργεια", E3_585_012: "Ύδρευση",
  E3_585_013: "Τηλεπικοινωνίες", E3_585_014: "Ενοίκια", E3_585_015: "Διαφήμιση και προβολή", E3_585_016: "Λοιπά έξοδα",
  E3_586: "Χρεωστικοί τόκοι και συναφή έξοδα", E3_882_001: "Αγορές ενσώματων παγίων, χονδρικές", E3_882_002: "Αγορές ενσώματων παγίων, λιανικές",
  E3_883_001: "Αγορές άυλων παγίων, χονδρικές", E3_883_002: "Αγορές άυλων παγίων, λιανικές",
};

export const VAT_LABEL: Record<string, string> = {
  VAT_361: "Αγορές και δαπάνες εσωτερικού", VAT_362: "Αγορές επενδυτικών αγαθών (πάγια)", VAT_363: "Λοιπές εισαγωγές",
  VAT_364: "Ενδοκοινοτικές αποκτήσεις αγαθών", VAT_365: "Ενδοκοινοτικές λήψεις υπηρεσιών", VAT_366: "Λοιπές πράξεις λήπτη",
};

/** «Ενέργεια (E3_585_011)»: ο χαρακτηρισμός με απλά λόγια για τη φόρμα και τις λίστες. */
export const e3Text = (type: string | null | undefined) => (type ? `${E3_LABEL[type] ?? type} (${type})` : "χωρίς χαρακτηρισμό");

/** Οι επιτρεπτοί τύποι Ε3 για παραστατικό και κατηγορία εξόδου· κενό = ο συνδυασμός δεν υπάρχει στο xlsx. */
export function allowedTypes(docType: string, category: string) {
  return COMBOS[docType]?.EXPENSE?.[category] ?? [];
}

/**
 * Ελέγχει «παραστατικό + κατηγορία + τύπος Ε3» απέναντι στους πίνακες της ΑΑΔΕ. Παραστατικό που δεν υπάρχει
 * στους πίνακες δεν ελέγχεται (π.χ. ανεπίσημη δαπάνη χωρίς τύπο). Το μήνυμα προτείνει τι να διαλέξει.
 */
export function checkCombo(docType: string | null | undefined, category: string | null | undefined, type: string | null | undefined) {
  if (!docType || !category || !type || !COMBOS[docType]) return;
  const docName = DOC_TYPES[docType] ? `${DOC_TYPES[docType]} ${docType}` : `παραστατικό ${docType}`;
  const byCategory = COMBOS[docType].EXPENSE;
  if (!byCategory) throw new ExpenseRuleError(`Το ${docName} δεν παίρνει χαρακτηρισμό εξόδου`);
  const allowed = byCategory[category];
  if (!allowed) throw new ExpenseRuleError(`Η κατηγορία «${CATEGORY_LABEL[category] ?? category}» δεν επιτρέπεται σε ${docName}`);
  if (allowed.includes(type)) return;
  // πρόταση: ο «αδελφός» κωδικός (ίδιο πρόθεμα), αλλιώς ο πρώτος επιτρεπτός
  const sibling = allowed.find((t) => t.slice(0, 6) === type.slice(0, 6)) ?? allowed[0];
  throw new ExpenseRuleError(`Το ${type} δεν επιτρέπεται σε ${docName}. Διάλεξε ${sibling}`);
}

/** Ο χαρακτηρισμός ΦΠΑ δεν στέλνεται σε απαλλαγή (σφάλμα ΑΑΔΕ 316): χωρίς ΦΠΑ στη δαπάνη, χωρίς τύπο ΦΠΑ. */
export const vatTypeFor = (vatType: string | null | undefined, vatCents: number) => (vatCents > 0 ? vatType ?? null : null);

/** Η δαπάνη θέλει έγκριση όταν το σύνολο ξεπερνά το όριο της επιχείρησης. */
export const needsApproval = (totalCents: number, thresholdCents: number | null | undefined) => thresholdCents != null && totalCents > thresholdCents;

const DAY = 86_400_000;
/**
 * Δαπάνη περιόδου (π.χ. ασφάλιστρο Ιαν–Μαρ) μοιρασμένη στους μήνες ανά ημέρα, με άθροισμα ακριβώς το ποσό.
 * Ημερομηνίες σε UTC μεσάνυχτα (πεδία @db.Date)· τα όρια συμπεριλαμβάνονται.
 */
export function splitByMonth(amountCents: number, from: Date, to: Date) {
  if (to < from) throw new ExpenseRuleError("Η περίοδος τελειώνει πριν αρχίσει");
  const days = new Map<string, number>();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const month = new Date(t).toISOString().slice(0, 7);
    days.set(month, (days.get(month) ?? 0) + 1);
  }
  const cents = allocateCents(amountCents, [...days].map(([id, weight]) => ({ id, weight })));
  return [...days.keys()].map((month) => ({ month, cents: cents.get(month)! }));
}

/** Προεπιλογές demo (Παράρτημα Α του οδικού χάρτη). Οι λογαριασμοί είναι προτάσεις· «κενό» = τον ορίζει ο λογιστής. center: κωδικός κέντρου ή null = του καταστήματος. */
export const DEFAULT_EXPENSE_TYPES = [
  { code: "E01", name: "Αγορές εμπορευμάτων", kind: "COGS", mydataCategory: "category2_1", mydataType: "E3_102_001", mydataVatType: "VAT_361", accountCode: "20.01", center: null },
  { code: "E02", name: "Πρώτες ύλες", kind: "COGS", mydataCategory: "category2_2", mydataType: "E3_202_001", mydataVatType: "VAT_361", accountCode: "24.01", center: "20" },
  { code: "E03", name: "Υλικά συσκευασίας", kind: "COGS", mydataCategory: "category2_2", mydataType: "E3_202_001", mydataVatType: "VAT_361", accountCode: "25.00", center: null },
  { code: "E04", name: "Ενέργεια (ρεύμα, φυσικό αέριο)", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_011", mydataVatType: "VAT_361", accountCode: "62.00", center: null },
  { code: "E05", name: "Ύδρευση", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_012", mydataVatType: "VAT_361", accountCode: "62.02", center: null },
  { code: "E06", name: "Τηλεπικοινωνίες και internet", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_013", mydataVatType: "VAT_361", accountCode: "62.03", center: null },
  { code: "E07", name: "Ενοίκια", kind: "OPEX", mydataCategory: "category2_5", mydataType: "E3_585_014", mydataVatType: "VAT_361", accountCode: "62.04", center: null },
  { code: "E08", name: "Αμοιβή λογιστή και ελεύθερων επαγγελματιών", kind: "OPEX", mydataCategory: "category2_3", mydataType: "E3_585_009", mydataVatType: "VAT_361", accountCode: "61.00", center: "30" },
  { code: "E09", name: "Διαφήμιση και προβολή", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_015", mydataVatType: "VAT_361", accountCode: "64.02", center: "50" },
  { code: "E10", name: "Προμήθειες Viva και πλατφορμών delivery", kind: "OPEX", mydataCategory: "category2_3", mydataType: "E3_585_016", mydataVatType: "VAT_361", accountCode: null, center: null },
  { code: "E11", name: "Συντηρήσεις και επισκευές", kind: "OPEX", mydataCategory: "category2_3", mydataType: "E3_585_016", mydataVatType: "VAT_361", accountCode: "62.07", center: null },
  { code: "E12", name: "Συνδρομές λογισμικού", kind: "OPEX", mydataCategory: "category2_3", mydataType: "E3_585_016", mydataVatType: "VAT_361", accountCode: null, center: "30" },
  { code: "E13", name: "Έξοδα υποδοχής και φιλοξενίας", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_005", mydataVatType: "VAT_361", accountCode: null, center: "30" },
  { code: "E14", name: "Τραπεζικά έξοδα και τόκοι", kind: "FINANCE", mydataCategory: "category2_3", mydataType: "E3_586", mydataVatType: null, accountCode: null, center: "30" },
  { code: "E15", name: "Εξοπλισμός (πάγια)", kind: "ASSET", mydataCategory: "category2_7", mydataType: "E3_882_001", mydataVatType: "VAT_362", accountCode: null, center: null },
  { code: "E16", name: "Λοιπά έξοδα", kind: "OPEX", mydataCategory: "category2_4", mydataType: "E3_585_016", mydataVatType: "VAT_361", accountCode: "64.98", center: null },
  { code: "P01", name: "Μισθοδοσία: μικτές αποδοχές", kind: "PAYROLL_COST", mydataCategory: "category2_6", mydataType: "E3_581_001", mydataVatType: null, accountCode: "60.00", center: null },
  { code: "P02", name: "Μισθοδοσία: εργοδοτικές εισφορές", kind: "PAYROLL_COST", mydataCategory: "category2_6", mydataType: "E3_581_002", mydataVatType: null, accountCode: "60.03", center: null },
] as const;
