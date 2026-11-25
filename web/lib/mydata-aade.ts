// ERP διαβίβαση myDATA 2.0.2. Τα credentials μένουν στον tenant και τα endpoints είναι allowlisted.
// Το receiptReference δεν αποστέλλεται ως μη τεκμηριωμένο header· η ταυτοποίηση retry γίνεται με RequestTransmittedDocs.
import { db } from "./db.ts";
import { lineTotals } from "./procurement.ts";
import { stockCostScale } from "./units.ts";
import { WorkflowError } from "./workflow-db.ts";
import type { MyDataProvider, MyDataReceipt, MyDataSubmission } from "./mydata-outgoing.ts";

const XML_NAMESPACE = "http://www.aade.gr/myDATA/invoice/v1.0";
const ENDPOINTS = {
  production: {
    send: "https://mydatapi.aade.gr/myDATA/SendInvoices",
    transmitted: "https://mydatapi.aade.gr/myDATA/RequestTransmittedDocs",
  },
  sandbox: {
    send: "https://mydataapidev.aade.gr/SendInvoices",
    transmitted: "https://mydataapidev.aade.gr/RequestTransmittedDocs",
  },
} as const;
const VAT_CATEGORIES: Readonly<Record<number, number>> = { 24: 1, 13: 2, 6: 3, 17: 4, 9: 5, 4: 6, 3: 9 };
const MAX_MARK = 9_223_372_036_854_775_807n;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 20;

export class DisabledMyDataProvider implements MyDataProvider {
  async submit(): Promise<MyDataReceipt> {
    throw new WorkflowError("Δεν έχει ρυθμιστεί πάροχος εξερχόμενης διαβίβασης myDATA· το παραστατικό παραμένει μη διαβιβασμένο");
  }
}

/** Το uncertain σημαίνει ότι το POST μπορεί να έχει γίνει αποδεκτό· απαιτείται reconciliation πριν από retry. */
export class AadeMyDataError extends WorkflowError {
  readonly uncertain: boolean;

  constructor(message: string, uncertain = false) {
    super(message);
    this.name = "AadeMyDataError";
    this.uncertain = uncertain;
  }
}

type Environment = keyof typeof ENDPOINTS;
type CustomerSnapshot = {
  vatNumber?: unknown;
  countryCode?: unknown;
  name?: unknown;
  address?: unknown;
  city?: unknown;
  postalCode?: unknown;
};

export type AadeOrganizationConfig = {
  id: string;
  vatNumber: string;
  aadeUserId: string | null;
  aadeSubKey: string | null;
};

export type AadeProviderDependencies = {
  fetch?: typeof fetch;
  environment?: Environment;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxReconciliationPages?: number;
  loadDimensions?: (genericItemIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
};

export type PreparedAadeInvoice = {
  xml: string;
  issuerVat: string;
  counterpartVat: string;
  series: string;
  aa: string;
  issueDate: string;
  docType: "1.1" | "5.1";
};

function fail(message: string): never {
  throw new AadeMyDataError(message);
}

function text(value: unknown, label: string, maximum: number, required = false): string {
  if (value !== undefined && value !== null && typeof value !== "string") fail(`${label}: μη έγκυρη τιμή`);
  const clean = typeof value === "string" ? value.trim() : "";
  if ((required && !clean) || clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(clean)) {
    fail(`${label}: ${required ? "υποχρεωτικό, " : ""}έως ${maximum} χαρακτήρες χωρίς χαρακτήρες ελέγχου`);
  }
  return clean;
}

function normalizedVat(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "").replace(/^EL(?=\d{9}$)/, "") : "";
}

function partyVat(value: unknown, country: string, label: string): string {
  const vat = normalizedVat(value);
  if (!vat || vat.length > 30 || !/^[A-Z0-9]+$/.test(vat) || (country === "GR" && !/^\d{9}$/.test(vat))) fail(`${label}: μη έγκυρος ΑΦΜ`);
  return vat;
}

function validMark(value: unknown, label = "MARK"): string {
  const mark = text(value, label, 19, true);
  if (!/^\d+$/.test(mark)) fail(`${label}: μη έγκυρη τιμή`);
  const numeric = BigInt(mark);
  if (numeric < 1n || numeric > MAX_MARK) fail(`${label}: εκτός επιτρεπτών ορίων`);
  return numeric.toString();
}

function validUid(value: unknown): string {
  const uid = text(value, "UID", 40, true);
  if (!/^[A-Za-z0-9]{40}$/.test(uid)) fail("UID: μη έγκυρη τιμή");
  return uid;
}

function validQr(value: unknown): string | undefined {
  const qr = text(value, "QR URL", 2048);
  if (!qr) return undefined;
  try {
    const url = new URL(qr);
    if (url.protocol !== "https:" || url.username || url.password) fail("QR URL: απαιτείται ασφαλές HTTPS URL χωρίς credentials");
    return url.toString();
  } catch (error) {
    if (error instanceof AadeMyDataError) throw error;
    fail("QR URL: μη έγκυρη τιμή");
  }
}

function money(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || String(cents).length > 15) fail("Ποσό παραστατικού: εκτός επιτρεπτών ορίων");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function quantity(value: number, scale: number): string {
  if (!Number.isSafeInteger(value) || value < 1) fail("Ποσότητα γραμμής: θετικός ακέραιος στη βασική μονάδα");
  const decimals = String(scale).length - 1;
  const fraction = String(value % scale).padStart(decimals, "0").replace(/0+$/, "");
  return `${Math.floor(value / scale)}${fraction ? `.${fraction}` : ""}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function athensDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("Ημερομηνία έκδοσης: μη έγκυρη τιμή");
  const date = value.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Ημερομηνία έκδοσης: μη έγκυρη τιμή");
  return date;
}

function queryDate(issueDate: string): string {
  return `${issueDate.slice(8, 10)}/${issueDate.slice(5, 7)}/${issueDate.slice(0, 4)}`;
}

function customerOf(value: unknown): CustomerSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Στοιχεία πελάτη: μη έγκυρο snapshot");
  return value as CustomerSnapshot;
}

/** Κανονικό, deterministic XML με τη σειρά του επίσημου InvoicesDoc-v2.0.2.xsd. */
export function buildAadeInvoice(document: MyDataSubmission, issuerVatInput: string, dimensions: ReadonlyMap<string, string>): PreparedAadeInvoice {
  if (document.docType === "9.3") fail("Ο τύπος 9.3 δεν διαβιβάζεται: λείπουν τα υποχρεωτικά στοιχεία διακίνησης και φόρτωσης");
  if (document.docType !== "1.1" && document.docType !== "5.1") fail(`Ο τύπος παραστατικού ${text(document.docType, "Τύπος", 20, true)} δεν υποστηρίζεται για αυτόματη διαβίβαση`);
  text(document.idempotencyKey, "Idempotency key", 200, true);
  const series = text(document.series, "Σειρά", 50, true);
  if (!Number.isSafeInteger(document.aa) || document.aa < 1) fail("ΑΑ παραστατικού: θετικός ακέραιος");
  const issueDate = athensDate(document.issuedAt);
  const issuerVat = partyVat(issuerVatInput, "GR", "ΑΦΜ εκδότη");
  const customer = customerOf(document.customer);
  const country = text(customer.countryCode ?? "GR", "Χώρα πελάτη", 2, true).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fail("Χώρα πελάτη: μη έγκυρος κωδικός ISO");
  const counterpartVat = partyVat(customer.vatNumber, country, "ΑΦΜ πελάτη");
  const name = country === "GR" ? "" : text(customer.name, "Επωνυμία πελάτη", 200);
  const street = text(customer.address, "Διεύθυνση πελάτη", 150);
  const city = text(customer.city, "Πόλη πελάτη", 150);
  const postalCode = text(customer.postalCode, "ΤΚ πελάτη", 30);
  if ((street || city || postalCode) && (!city || !postalCode)) fail("Διεύθυνση πελάτη: πόλη και ΤΚ είναι υποχρεωτικά όταν δηλώνεται διεύθυνση");
  const relatedMark = document.docType === "5.1" ? validMark(document.relatedMark, "Συσχετιζόμενο MARK") : undefined;
  if (!Array.isArray(document.lines) || !document.lines.length) fail("Το παραστατικό δεν έχει γραμμές");

  let computedNet = 0;
  let computedVat = 0;
  const detailXml: string[] = [];
  for (const [index, line] of document.lines.entries()) {
    const dimension = dimensions.get(line.genericItemId);
    if (dimension !== "mass" && dimension !== "volume" && dimension !== "count") fail("Μονάδα είδους: δεν βρέθηκε έγκυρη, tenant-scoped βασική μονάδα");
    const vatCategory = VAT_CATEGORIES[line.vatRate];
    if (line.vatRate === 0) fail("ΦΠΑ 0%: απαιτείται κατηγορία απαλλαγής πριν από τη διαβίβαση");
    if (!vatCategory) fail(`Μη υποστηριζόμενος συντελεστής ΦΠΑ ${line.vatRate}`);
    const scale = stockCostScale(dimension);
    const totals = lineTotals(line.quantityBase, line.unitPriceCents, line.vatRate, 0, scale);
    computedNet += totals.netCents;
    computedVat += totals.vatCents;
    if (!Number.isSafeInteger(computedNet) || !Number.isSafeInteger(computedVat)) fail("Σύνολα παραστατικού: εκτός ασφαλών ορίων");
    const measurementUnit = dimension === "count" ? 1 : dimension === "mass" ? 2 : 3;
    detailXml.push(
      "    <invoiceDetails>",
      `      <lineNumber>${index + 1}</lineNumber>`,
      `      <quantity>${quantity(line.quantityBase, dimension === "count" ? 1 : scale)}</quantity>`,
      `      <measurementUnit>${measurementUnit}</measurementUnit>`,
      `      <netValue>${money(totals.netCents)}</netValue>`,
      `      <vatCategory>${vatCategory}</vatCategory>`,
      `      <vatAmount>${money(totals.vatCents)}</vatAmount>`,
      "    </invoiceDetails>",
    );
  }
  if (![document.netCents, document.vatCents, document.totalCents].every(Number.isSafeInteger) || document.netCents !== computedNet || document.vatCents !== computedVat || document.totalCents !== computedNet + computedVat) {
    fail("Τα αποθηκευμένα σύνολα δεν συμφωνούν με τις γραμμές· η διαβίβαση ακυρώθηκε πριν από το δίκτυο");
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<InvoicesDoc xmlns="${XML_NAMESPACE}">`,
    "  <invoice>",
    "    <issuer>",
    `      <vatNumber>${issuerVat}</vatNumber>`,
    "      <country>GR</country>",
    "      <branch>0</branch>",
    "    </issuer>",
    "    <counterpart>",
    `      <vatNumber>${escapeXml(counterpartVat)}</vatNumber>`,
    `      <country>${country}</country>`,
    "      <branch>0</branch>",
    ...(name ? [`      <name>${escapeXml(name)}</name>`] : []),
    ...(city && postalCode ? [
      "      <address>",
      ...(street ? [`        <street>${escapeXml(street)}</street>`] : []),
      `        <postalCode>${escapeXml(postalCode)}</postalCode>`,
      `        <city>${escapeXml(city)}</city>`,
      "      </address>",
    ] : []),
    "    </counterpart>",
    "    <invoiceHeader>",
    `      <series>${escapeXml(series)}</series>`,
    `      <aa>${document.aa}</aa>`,
    `      <issueDate>${issueDate}</issueDate>`,
    `      <invoiceType>${document.docType}</invoiceType>`,
    "      <currency>EUR</currency>",
    ...(relatedMark ? [`      <correlatedInvoices>${relatedMark}</correlatedInvoices>`] : []),
    "    </invoiceHeader>",
    ...detailXml,
    "    <invoiceSummary>",
    `      <totalNetValue>${money(computedNet)}</totalNetValue>`,
    `      <totalVatAmount>${money(computedVat)}</totalVatAmount>`,
    "      <totalWithheldAmount>0.00</totalWithheldAmount>",
    "      <totalFeesAmount>0.00</totalFeesAmount>",
    "      <totalStampDutyAmount>0.00</totalStampDutyAmount>",
    "      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>",
    "      <totalDeductionsAmount>0.00</totalDeductionsAmount>",
    `      <totalGrossValue>${money(computedNet + computedVat)}</totalGrossValue>`,
    "    </invoiceSummary>",
    "  </invoice>",
    "</InvoicesDoc>",
    "",
  ].join("\n");
  return { xml, issuerVat, counterpartVat, series, aa: String(document.aa), issueDate, docType: document.docType };
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (whole, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (named) return ENTITIES[named] ?? whole;
    const code = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16);
    if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    try { return String.fromCodePoint(code); } catch { return whole; }
  });
}

const PREFIX = String.raw`(?:[A-Za-z_][\w.-]*:)?`;
function blocks(xml: string, name: string): string[] {
  const expression = new RegExp(`<${PREFIX}${name}(?:\\s[^<>]*?)?>([\\s\\S]*?)<\\/${PREFIX}${name}\\s*>`, "g");
  return [...xml.matchAll(expression)].map((match) => match[1]!);
}

function tag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${PREFIX}${name}(?:\\s[^<>]*?)?>([^<]*)<\\/${PREFIX}${name}\\s*>`));
  return match ? decodeXml(match[1]!).trim() : null;
}

function assertRoot(xml: string, root: string): void {
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml) || !new RegExp(`<${PREFIX}${root}(?:\\s[^<>]*?)?>`).test(xml)) fail("Η ΑΑΔΕ επέστρεψε μη έγκυρο XML");
}

function receiptFromTags(markValue: unknown, uidValue: unknown, qrValue: unknown): MyDataReceipt {
  const mark = validMark(markValue);
  const uid = validUid(uidValue);
  const qrUrl = validQr(qrValue);
  return { mark, uid, ...(qrUrl ? { qrUrl } : {}) };
}

function parseSendReceipt(xml: string): MyDataReceipt {
  assertRoot(xml, "ResponseDoc");
  const responses = blocks(xml, "response");
  if (responses.length !== 1) throw new AadeMyDataError("Η ΑΑΔΕ επέστρεψε ασαφή απάντηση διαβίβασης", true);
  const response = responses[0]!;
  const status = tag(response, "statusCode");
  if (status !== "Success") {
    if (status === "ValidationError" || status === "TechnicalError" || status === "XMLSyntaxError") {
      const codes = blocks(response, "error").map((error) => tag(error, "code") ?? "").filter((code) => /^[A-Za-z0-9_.-]{1,80}$/.test(code)).slice(0, 5);
      throw new AadeMyDataError(`Η ΑΑΔΕ απέρριψε τη διαβίβαση (${status})${codes.length ? `· κωδικοί: ${codes.join(", ")}` : ""}`);
    }
    throw new AadeMyDataError("Η ΑΑΔΕ επέστρεψε άγνωστο αποτέλεσμα διαβίβασης", true);
  }
  try {
    return receiptFromTags(tag(response, "invoiceMark"), tag(response, "invoiceUid"), tag(response, "qrUrl"));
  } catch {
    throw new AadeMyDataError("Η επιτυχής απάντηση δεν περιέχει έγκυρα MARK και UID· απαιτείται επαλήθευση", true);
  }
}

function matchesInvoice(xml: string, expected: PreparedAadeInvoice): boolean {
  const issuer = blocks(xml, "issuer")[0] ?? "";
  const counterpart = blocks(xml, "counterpart")[0] ?? "";
  const header = blocks(xml, "invoiceHeader")[0] ?? "";
  return normalizedVat(tag(issuer, "vatNumber")) === expected.issuerVat
    && tag(issuer, "branch") === "0"
    && normalizedVat(tag(counterpart, "vatNumber")) === expected.counterpartVat
    && tag(header, "series") === expected.series
    && tag(header, "aa") === expected.aa
    && tag(header, "issueDate") === expected.issueDate
    && tag(header, "invoiceType") === expected.docType;
}

function continuationOf(xml: string): { nextPartitionKey: string; nextRowKey: string } | null {
  const continuations = blocks(xml, "continuationToken");
  if (!continuations.length) return null;
  if (continuations.length !== 1) fail("Η ΑΑΔΕ επέστρεψε μη έγκυρο continuation token");
  const nextPartitionKey = tag(continuations[0]!, "nextPartitionKey") ?? "";
  const nextRowKey = tag(continuations[0]!, "nextRowKey") ?? "";
  if (!nextPartitionKey || !nextRowKey || nextPartitionKey.length > 2000 || nextRowKey.length > 2000) fail("Η ΑΑΔΕ επέστρεψε μη έγκυρο continuation token");
  return { nextPartitionKey, nextRowKey };
}

class BoundedResponseError extends Error {}

async function boundedText(response: Response, maximum: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && !/^\d+$/.test(declared)) {
    await response.body?.cancel().catch(() => {});
    throw new BoundedResponseError();
  }
  if ((declared ? Number(declared) : 0) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new BoundedResponseError();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        throw new BoundedResponseError();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function boundedOption(value: number | undefined, fallback: number, maximum: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) fail("Μη έγκυρα όρια ασφαλείας του provider myDATA");
  return selected;
}

function environmentOf(value: unknown): Environment {
  if (value === undefined || value === null || value === "" || value === "production") return "production";
  if (value === "sandbox") return "sandbox";
  fail("Μη έγκυρο περιβάλλον myDATA· επιτρέπονται μόνο production και sandbox");
}

async function tenantDimensions(orgId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const items = await db.genericItem.findMany({
    where: { orgId, id: { in: [...ids] } },
    select: { id: true, baseUnit: { select: { dimension: true } } },
  });
  return new Map(items.map((item) => [item.id, item.baseUnit.dimension]));
}

export class AadeMyDataProvider implements MyDataProvider {
  private readonly fetcher: typeof fetch;
  private readonly endpoints: (typeof ENDPOINTS)[Environment];
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxReconciliationPages: number;
  private readonly loadDimensions: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  private readonly inFlight = new Map<string, Promise<MyDataReceipt>>();
  private readonly config: { orgId: string; issuerVat: string; userId: string; subscriptionKey: string };

  constructor(config: { orgId: string; issuerVat: string; userId: string; subscriptionKey: string }, dependencies: AadeProviderDependencies = {}) {
    this.config = config;
    this.fetcher = dependencies.fetch ?? fetch;
    this.endpoints = ENDPOINTS[environmentOf(dependencies.environment)];
    this.timeoutMs = boundedOption(dependencies.timeoutMs, DEFAULT_TIMEOUT_MS, 120_000);
    this.maxResponseBytes = boundedOption(dependencies.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 10 * 1024 * 1024);
    this.maxReconciliationPages = boundedOption(dependencies.maxReconciliationPages, DEFAULT_MAX_PAGES, 100);
    this.loadDimensions = dependencies.loadDimensions ?? ((ids) => tenantDimensions(config.orgId, ids));
    text(config.orgId, "Organization", 200, true);
    text(config.userId, "AADE user id", 200, true);
    text(config.subscriptionKey, "AADE subscription key", 500, true);
  }

  submit(document: MyDataSubmission): Promise<MyDataReceipt> {
    const key = text(document.idempotencyKey, "Idempotency key", 200, true);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const running = this.performSubmit(document);
    const tracked = running.finally(() => {
      if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
    });
    this.inFlight.set(key, tracked);
    return tracked;
  }

  private headers(): Record<string, string> {
    return { "aade-user-id": this.config.userId, "ocp-apim-subscription-key": this.config.subscriptionKey, accept: "application/xml" };
  }

  private async request(url: string, method: "GET" | "POST", body: string | undefined, operation: string, mayHaveSubmitted: boolean): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: { ...this.headers(), ...(body !== undefined ? { "content-type": "application/xml; charset=utf-8" } : {}) },
        body,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AadeMyDataError(`${operation}: η ΑΑΔΕ δεν απάντησε εγκαίρως`, mayHaveSubmitted);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const ambiguous = mayHaveSubmitted && (response.status === 408 || response.status === 429 || response.status >= 500);
      throw new AadeMyDataError(`${operation}: HTTP ${response.status}`, ambiguous);
    }
    try {
      return await boundedText(response, this.maxResponseBytes);
    } catch (error) {
      if (error instanceof BoundedResponseError) throw new AadeMyDataError(`${operation}: η απάντηση υπερέβη το επιτρεπτό όριο`, mayHaveSubmitted);
      throw new AadeMyDataError(`${operation}: η απάντηση διακόπηκε ή δεν ήταν έγκυρο UTF-8`, mayHaveSubmitted);
    }
  }

  private async reconcile(expected: PreparedAadeInvoice): Promise<MyDataReceipt | null> {
    const matches = new Map<string, { receipt: MyDataReceipt; cancelled: boolean }>();
    const cancelledMarks = new Set<string>();
    let continuation: { nextPartitionKey: string; nextRowKey: string } | null = null;
    const seenTokens = new Set<string>();
    for (let page = 0; page < this.maxReconciliationPages; page += 1) {
      const parameters = new URLSearchParams({
        mark: "0",
        dateFrom: queryDate(expected.issueDate),
        dateTo: queryDate(expected.issueDate),
        receiverVatNumber: expected.counterpartVat,
        invType: expected.docType,
        ...(continuation ?? {}),
      });
      const xml = await this.request(`${this.endpoints.transmitted}?${parameters}`, "GET", undefined, "Ο έλεγχος προηγούμενης διαβίβασης απέτυχε", false);
      assertRoot(xml, "RequestedDoc");
      for (const cancelled of blocks(xml, "cancelledInvoice")) {
        const value = tag(cancelled, "invoiceMark");
        if (value && /^\d{1,19}$/.test(value)) cancelledMarks.add(validMark(value));
      }
      for (const invoice of blocks(xml, "invoice")) {
        if (!matchesInvoice(invoice, expected)) continue;
        let receipt: MyDataReceipt;
        try { receipt = receiptFromTags(tag(invoice, "mark"), tag(invoice, "uid"), tag(invoice, "qrCodeUrl")); }
        catch { throw new AadeMyDataError("Βρέθηκε αντίστοιχο παραστατικό με μη έγκυρα MARK, UID ή QR· απαιτείται έλεγχος"); }
        const mark = receipt.mark;
        const previous = matches.get(mark);
        if (previous && JSON.stringify(previous.receipt) !== JSON.stringify(receipt)) throw new AadeMyDataError("Βρέθηκαν ασαφή στοιχεία προηγούμενης διαβίβασης· απαιτείται έλεγχος");
        matches.set(mark, { receipt, cancelled: previous?.cancelled || Boolean(tag(invoice, "cancelledByMark")) });
      }
      continuation = continuationOf(xml);
      if (!continuation) break;
      const token = JSON.stringify(continuation);
      if (seenTokens.has(token)) throw new AadeMyDataError("Η σελιδοποίηση της ΑΑΔΕ επαναλήφθηκε· η διαβίβαση δεν θα επαναληφθεί");
      seenTokens.add(token);
      if (page + 1 === this.maxReconciliationPages) throw new AadeMyDataError("Η ανάκτηση προηγούμενης διαβίβασης ξεπέρασε το όριο σελίδων· δεν θα γίνει νέο POST");
    }
    if (!matches.size) return null;
    if (matches.size > 1 || [...matches.values()].some((match) => match.cancelled || cancelledMarks.has(match.receipt.mark))) {
      throw new AadeMyDataError("Βρέθηκε ακυρωμένη ή πολλαπλή αντίστοιχη διαβίβαση· απαιτείται χειροκίνητος έλεγχος πριν από retry");
    }
    return [...matches.values()][0]!.receipt;
  }

  private async performSubmit(document: MyDataSubmission): Promise<MyDataReceipt> {
    const ids = [...new Set(document.lines.map((line) => line.genericItemId))];
    const dimensions = await this.loadDimensions(ids);
    const invoice = buildAadeInvoice(document, this.config.issuerVat, dimensions);
    const previous = await this.reconcile(invoice);
    if (previous) return previous;
    try {
      const response = await this.request(this.endpoints.send, "POST", invoice.xml, "Η διαβίβαση απέτυχε", true);
      return parseSendReceipt(response);
    } catch (error) {
      if (!(error instanceof AadeMyDataError) || !error.uncertain) throw error;
      // Μετά από timeout/network/άκυρη απάντηση δεν ξανακάνουμε POST: ψάχνουμε πρώτα το πραγματικό MARK.
      try {
        const transmitted = await this.reconcile(invoice);
        if (transmitted) return transmitted;
      } catch {
        // Το τελικό μήνυμα παραμένει σκόπιμα γενικό, χωρίς body, URLs ή credentials.
      }
      throw new AadeMyDataError("Η διαβίβαση έμεινε αβέβαιη και δεν επιβεβαιώθηκε με reconciliation· έλεγξε πριν από νέα προσπάθεια");
    }
  }
}

/** Pure επιλογή: ελλιπή/μερικά credentials ή λάθος tenant σημαίνουν πάντα Disabled provider. */
export function aadeProviderForOrganization(orgId: string, organization: AadeOrganizationConfig | null, dependencies: AadeProviderDependencies = {}): MyDataProvider {
  if (!organization || organization.id !== orgId || !organization.aadeUserId?.trim() || !organization.aadeSubKey?.trim()) return new DisabledMyDataProvider();
  return new AadeMyDataProvider({ orgId, issuerVat: organization.vatNumber, userId: organization.aadeUserId.trim(), subscriptionKey: organization.aadeSubKey.trim() }, dependencies);
}

/** issuer: ο εκδότης του καταστήματος (lib/documents/issuer.ts)· χωρίς αυτόν, τα στοιχεία της επιχείρησης. */
export async function createAadeMyDataProvider(orgId: string, dependencies: AadeProviderDependencies = {}, issuer?: { vatNumber: string; aadeUserId: string | null; aadeSubKey: string | null }): Promise<MyDataProvider> {
  const organization = issuer ? { id: orgId, ...issuer } : await db.organization.findFirst({
    where: { id: orgId },
    select: { id: true, vatNumber: true, aadeUserId: true, aadeSubKey: true },
  });
  return aadeProviderForOrganization(orgId, organization, {
    ...dependencies,
    environment: dependencies.environment ?? environmentOf(process.env.AADE_MYDATA_ENV),
  });
}
