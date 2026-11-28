// Καθαρός parser της απάντησης RequestMyIncome του myDATA (ΑΑΔΕ) — δοκιμάζεται με node --test.
// Η λήψη και η εισαγωγή στη βάση είναι στο mydata-income.ts.

export type MyIncomeDoc = {
  mark: string; // μοναδικός αριθμός καταχώρισης myDATA
  supplierVat: string; // ΑΦΜ εκδότη
  supplierName: string;
  number: string | null; // ο αριθμός (aa) του παραστατικού
  issuedAt: Date | null;
  type: string | null; // invoiceType της ΑΑΔΕ: 1.1, 5.1, 5.2 …
  relatedMark: string | null; // correlatedInvoices: το MARK που πιστώνει ένα 5.1
  lines: { description: string; quantity: number; unitPriceCents: number; discountBps: number; vatRate: number }[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(\w+);/g, (m, e: string) => ENTITIES[e] ?? m);

/** Περιεχόμενο πρώτης ετικέτας (ανεξάρτητα από πρόθεμα namespace) ή null. */
const tag = (xml: string, name: string): string | null => xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</`))?.[1]?.trim() || null;
/** Όλα τα μπλοκ <name>…</name> του εγγράφου. */
const blocks = (xml: string, name: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((m) => m[1]);

const dayOf = (s: string | null): Date | null => {
  const d = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** RequestedDoc → λίστα παραστατικών αγοράς. Αγνοεί όσα δεν είναι τιμολόγια με γραμμές. */
export function parseMyIncomeXml(xml: string): MyIncomeDoc[] {
  const out: MyIncomeDoc[] = [];
  for (const doc of blocks(xml, "invoiceDoc")) {
    const mark = tag(doc, "invoiceMark");
    if (!mark) continue; // χωρίς ΜΑΡΚ δεν μπορούμε να κάνουμε dedupe — δεν το εισάγουμε
    const counterpart = blocks(doc, "counterpart")[0] ?? "";
    const supplierVat = (tag(counterpart, "vatNumber") ?? "").replace(/^EL/i, "");
    const supplierName = decode(tag(counterpart, "name") ?? "").trim();
    const number = decode(tag(doc, "aa") ?? "") || null;
    const issuedAt = dayOf(tag(doc, "issueDate"));
    const lines: MyIncomeDoc["lines"] = [];
    for (const det of blocks(doc, "invoiceDetails")) {
      const description = decode(tag(det, "itemDescr") ?? "").trim().slice(0, 120);
      const qty = Number(tag(det, "quantity") ?? "0");
      const net = Number(tag(det, "netValue") ?? "0"); // καθαρή αξία γραμμής (προ ΦΠΑ)
      if (!description || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(net)) continue;
      // Η κατηγορία ΦΠΑ της ΑΑΔΕ μεταφράζεται σε snapshot ποσοστού. Χωρίς κατηγορία μένει 0 και ελέγχεται στο πρόχειρο.
      const vatRate = ({ "1": 24, "2": 13, "3": 6, "4": 17, "5": 9, "6": 4, "7": 0 } as Record<string, number>)[tag(det, "vatCategory") ?? ""] ?? 0;
      lines.push({ description, quantity: Math.max(1, Math.round(qty)), unitPriceCents: Math.max(0, Math.round((net / qty) * 100)), discountBps: 0, vatRate });
    }
    if (!supplierVat || !lines.length) continue;
    out.push({ mark, supplierVat, supplierName: supplierName || `Προμηθευτής ${supplierVat}`, number, issuedAt, type: tag(doc, "invoiceType"), relatedMark: tag(doc, "correlatedInvoices"), lines });
  }
  return out;
}
