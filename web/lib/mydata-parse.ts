// Καθαρός parser της απάντησης RequestDocs του myDATA (ΑΑΔΕ) — δοκιμάζεται με node --test.
// Η λήψη και η εισαγωγή στη βάση είναι στο mydata-income.ts.

export type MyIncomeDoc = {
  mark: string; // μοναδικός αριθμός καταχώρισης myDATA
  supplierVat: string; // ΑΦΜ εκδότη
  supplierName: string;
  series: string | null; // η σειρά του παραστατικού
  number: string | null; // ο αριθμός (aa) του παραστατικού
  issuedAt: Date | null;
  type: string | null; // invoiceType της ΑΑΔΕ: 1.1, 5.1, 5.2 …
  relatedMark: string | null; // correlatedInvoices: το MARK που πιστώνει ένα 5.1
  netCents: number | null; vatCents: number | null; grossCents: number | null; // invoiceSummary
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

/** Σφάλμα της ΑΑΔΕ μέσα σε απάντηση HTTP 200 (π.χ. 105: χωρίς δικαίωμα για αυτό το ΑΦΜ) ή null. */
export function mydataFault(xml: string): string | null {
  if (!/<(?:\w+:)?ResponseDoc[\s>]/.test(xml)) return null;
  const status = tag(xml, "statusCode");
  if (!status || status === "Success") return null;
  const err = blocks(xml, "error")[0] ?? "";
  return `${decode(tag(err, "message") ?? status)}${tag(err, "code") ? ` (κωδ. ${tag(err, "code")})` : ""}`;
}

/** Επόμενη σελίδα του RequestDocs (continuationToken) ή null. */
export function continuation(xml: string): { nextPartitionKey: string; nextRowKey: string } | null {
  const pk = tag(xml, "nextPartitionKey"), rk = tag(xml, "nextRowKey");
  return pk && rk ? { nextPartitionKey: pk, nextRowKey: rk } : null;
}

const cents = (s: string | null) => (s && Number.isFinite(Number(s)) ? Math.round(Number(s) * 100) : null);

/**
 * RequestDocs (παραστατικά που εξέδωσαν άλλοι προς εμάς) → λίστα παραστατικών αγοράς.
 * Ο προμηθευτής είναι ο issuer· ο counterpart είμαστε εμείς. Τα ακυρωμένα (cancelledByMark) αγνοούνται.
 */
export function parseMyIncomeXml(xml: string): MyIncomeDoc[] {
  const out: MyIncomeDoc[] = [];
  for (const doc of blocks(xml, "invoice")) {
    const mark = tag(doc, "mark");
    if (!mark || tag(doc, "cancelledByMark")) continue; // χωρίς ΜΑΡΚ δεν γίνεται dedupe· ακυρωμένο δεν ισχύει
    const issuer = blocks(doc, "issuer")[0] ?? "";
    const supplierVat = (tag(issuer, "vatNumber") ?? "").replace(/^EL/i, "");
    const supplierName = decode(tag(issuer, "name") ?? "").trim();
    const header = blocks(doc, "invoiceHeader")[0] ?? "";
    const summary = blocks(doc, "invoiceSummary")[0] ?? "";
    const lines: MyIncomeDoc["lines"] = [];
    for (const det of blocks(doc, "invoiceDetails")) {
      // η περιγραφή είναι προαιρετική στο myDATA· χωρίς αυτήν η γραμμή κρατιέται με τον αριθμό της
      const description = (decode(tag(det, "itemDescr") ?? "").trim() || `Γραμμή ${tag(det, "lineNumber") ?? lines.length + 1}`).slice(0, 120);
      const qty = Number(tag(det, "quantity") ?? "1");
      const net = Number(tag(det, "netValue") ?? "0"); // καθαρή αξία γραμμής (προ ΦΠΑ)
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(net)) continue;
      // Η κατηγορία ΦΠΑ της ΑΑΔΕ μεταφράζεται σε snapshot ποσοστού. Χωρίς κατηγορία μένει 0 και ελέγχεται στο πρόχειρο.
      const vatRate = ({ "1": 24, "2": 13, "3": 6, "4": 17, "5": 9, "6": 4, "7": 0 } as Record<string, number>)[tag(det, "vatCategory") ?? ""] ?? 0;
      lines.push({ description, quantity: Math.max(1, Math.round(qty)), unitPriceCents: Math.max(0, Math.round((net / qty) * 100)), discountBps: 0, vatRate });
    }
    if (!supplierVat || !lines.length) continue;
    out.push({
      mark, supplierVat, supplierName: supplierName || `Προμηθευτής ${supplierVat}`,
      series: decode(tag(header, "series") ?? "") || null, number: decode(tag(header, "aa") ?? "") || null, issuedAt: dayOf(tag(header, "issueDate")),
      type: tag(header, "invoiceType"), relatedMark: tag(header, "correlatedInvoices"),
      netCents: cents(tag(summary, "totalNetValue")), vatCents: cents(tag(summary, "totalVatAmount")), grossCents: cents(tag(summary, "totalGrossValue")), lines,
    });
  }
  return out;
}

/** Ό,τι διαβάστηκε από τη φωτογραφία του παραστατικού. */
export type ScannedHeader = {
  vatNumber: string | null; number: string | null; issuedAt: string | Date | null; mark?: string | null;
  /** μόνο όταν το παραστατικό έχει ποσά (τιμολόγιο)· το δελτίο αποστολής δεν έχει */
  totals?: { netCents: number; vatCents: number; grossCents: number } | null;
};
export type MydataDiff = { field: "vat" | "number" | "date" | "mark" | "net" | "vat_amount" | "gross"; label: string; scanned: string; mydata: string };

const euro = (c: number) => `${(c / 100).toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const norm = (s: string) => s.toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, "").replace(/^0+(?=\d)/, "");
const isoDay = (d: string | Date | null) => (!d ? "" : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Ο αριθμός του χαρτιού είναι ο ίδιος με του myDATA, με ή χωρίς τη σειρά και τα μηδενικά μπροστά. */
export const sameNumber = (scanned: string, doc: Pick<MyIncomeDoc, "series" | "number">) =>
  !!doc.number && [doc.number, `${doc.series ?? ""}${doc.number}`].some((n) => norm(n) === norm(scanned));

/**
 * Σύγκριση σκαναρισμένου παραστατικού με αυτό που δηλώθηκε στο myDATA. Κενή λίστα = ίδια στοιχεία.
 * Πεδίο που δεν διαβάστηκε από τη φωτογραφία δεν μετρά ως διαφορά. Ο αριθμός ταιριάζει με ή χωρίς τη σειρά.
 */
export function diffWithMydata(scanned: ScannedHeader, doc: MyIncomeDoc): MydataDiff[] {
  const out: MydataDiff[] = [];
  const vat = (scanned.vatNumber ?? "").replace(/^EL/i, "").trim();
  if (vat && vat !== doc.supplierVat) out.push({ field: "vat", label: "ΑΦΜ εκδότη", scanned: vat, mydata: doc.supplierVat });
  if (scanned.number && doc.number) {
    if (!sameNumber(scanned.number, doc)) out.push({ field: "number", label: "Αριθμός", scanned: scanned.number, mydata: [doc.series, doc.number].filter(Boolean).join("-") });
  }
  const day = isoDay(scanned.issuedAt), mday = isoDay(doc.issuedAt);
  if (day && mday && day !== mday) out.push({ field: "date", label: "Ημερομηνία", scanned: day, mydata: mday });
  if (scanned.mark && scanned.mark.trim() !== doc.mark) out.push({ field: "mark", label: "ΜΑΡΚ", scanned: scanned.mark.trim(), mydata: doc.mark });
  // ποσά με ανοχή 1 λεπτού (στρογγυλοποίηση ΦΠΑ ανά γραμμή ή ανά σύνολο)
  const t = scanned.totals;
  for (const [field, label, a, b] of [["net", "Καθαρή αξία", t?.netCents, doc.netCents], ["vat_amount", "ΦΠΑ", t?.vatCents, doc.vatCents], ["gross", "Σύνολο", t?.grossCents, doc.grossCents]] as const)
    if (a != null && b != null && Math.abs(a - b) > 1) out.push({ field, label, scanned: euro(a), mydata: euro(b) });
  return out;
}
