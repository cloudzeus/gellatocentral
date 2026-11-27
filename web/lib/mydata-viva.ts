// Διαβίβαση παραστατικών χονδρικής μέσω Viva Fiscalisation (πάροχος ηλεκτρονικής τιμολόγησης),
// για επιχειρήσεις με merchant κάτω από τον ISV λογαριασμό μας (Organization.vivaMerchantId).
// Χωρίς τερματικό: POST receipts:sign με sessionId στο σώμα. Χωρίς sessionId η Viva απαντά 409 PaymentMethodsRequestFailed
// σε ό,τι δεν έχει transactionId (επί πιστώσει, μετρητά, μεταφορά)· με sessionId περνούν όλα. Ίδιο sessionId και σώμα
// → το ίδιο MARK (επανάληψη χωρίς διπλή διαβίβαση). Επαληθευμένο στο demo 2026-11-27.
// Ίδιο συμβόλαιο με τον πάροχο ΑΑΔΕ (MyDataProvider), ώστε η transmitSalesDocument να μένει μία.
import { buildDocument, type Dispatch, type DocLine } from "./documents/build.ts";
import { myDataUnit } from "./documents/mydata.ts";
import { lineTotals } from "./procurement.ts";
import { stockCostScale } from "./units.ts";
import { ON_CREDIT, toVivaJson, type Nature } from "./viva/fiscal.ts";
import { WorkflowError } from "./workflow-db.ts";
import type { MyDataProvider, MyDataReceipt, MyDataSubmission } from "./mydata-outgoing.ts";

export type VivaItem = { name: string; nature: Nature; dimension: string };
type Customer = { vatNumber?: unknown; name?: unknown; countryCode?: unknown; address?: unknown; city?: unknown; postalCode?: unknown };
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Pure: το fiscalisationData ενός παραστατικού χονδρικής (ελέγχεται χωρίς δίκτυο). */
export function vivaWholesaleData(document: MyDataSubmission, issuerVat: string, items: ReadonlyMap<string, VivaItem>) {
  const customer = (document.customer ?? {}) as Customer;
  const lines: DocLine[] = document.lines.map((line) => {
    const item = items.get(line.genericItemId);
    if (!item) throw new WorkflowError("Είδος παραστατικού δεν βρέθηκε στην επιχείρηση");
    const unit = myDataUnit(item.dimension);
    const totals = lineTotals(line.quantityBase, line.unitPriceCents, line.vatRate, 0, stockCostScale(item.dimension));
    return { name: item.name, nature: item.nature, quantity: line.quantityBase / unit.perBase, unitPriceCents: 0, vatRate: line.vatRate, amountCents: totals.totalCents, vatCents: totals.vatCents, measurementUnit: unit.code };
  });
  return buildDocument({
    docType: document.docType,
    merchantVat: issuerVat,
    series: document.series,
    aa: document.aa,
    reference: document.idempotencyKey,
    moment: document.issuedAt,
    payItem: document.docType === "9.3" ? undefined : ON_CREDIT, // η είσπραξη καταγράφεται χωριστά (CustomerPayment)
    party: { vatNumber: str(customer.vatNumber), name: str(customer.name), street: str(customer.address), city: str(customer.city), zip: str(customer.postalCode), country: str(customer.countryCode) || "GR" },
    relatedMark: document.relatedMark,
    dispatch: document.dispatch,
    lines,
  });
}

/** Pure: το σώμα του receipts:sign· sessionId = idempotencyKey (UUID), ώστε η επανάληψη να δίνει το ίδιο MARK. */
export function vivaSignBody(document: MyDataSubmission, issuerVat: string, items: ReadonlyMap<string, VivaItem>): string {
  return toVivaJson({ sessionId: document.idempotencyKey, ...vivaWholesaleData(document, issuerVat, items).data });
}

export class VivaMyDataProvider implements MyDataProvider {
  private readonly config: { orgId: string; issuerVat: string; merchantId: string };
  private readonly loadItems: (ids: readonly string[]) => Promise<ReadonlyMap<string, VivaItem>>;

  constructor(config: { orgId: string; issuerVat: string; merchantId: string }, loadItems: (ids: readonly string[]) => Promise<ReadonlyMap<string, VivaItem>>) {
    this.config = config;
    this.loadItems = loadItems;
  }

  async submit(document: MyDataSubmission): Promise<MyDataReceipt> {
    const items = await this.loadItems([...new Set(document.lines.map((l) => l.genericItemId))]);
    const { signReceipt } = await import("./viva/sign.ts");
    const signed = await signReceipt(vivaSignBody(document, this.config.issuerVat, items), this.config.merchantId);
    return { mark: signed.mark, uid: signed.uid, qrUrl: signed.qrUrl, raw: { pdfUrl: signed.pdfUrl, authCode: signed.authCode, response: signed.raw } };
  }
}

export type { Dispatch };
