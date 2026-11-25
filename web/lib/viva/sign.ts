// Υπογραφή και διαβίβαση παραστατικού εκτός ταμείου μέσω Viva Fiscalisation (πάροχος ηλεκτρονικής τιμολόγησης):
// POST /fiscalization/v1/receipts:sign (λογαριασμός της πλατφόρμας) ή /fiscalization/v1/isv/receipts:sign?merchantId=…
// (επιχείρηση-πελάτης κάτω από τον ISV). Πηγή: viva-fiscalisation greece-online-sales, επαληθευμένο στο demo 2026-11-25.

const TIMEOUT_MS = 30_000;

export type SignedReceipt = { mark: string; uid?: string; authCode?: string; qrUrl?: string; pdfUrl?: string; raw: unknown };

export class VivaSignError extends Error {}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];

/** Ερμηνεύει την απάντηση της Viva· χωρίς MARK η διαβίβαση δεν έγινε (το παραστατικό ξαναστέλνεται). */
export function parseSignResponse(text: string): SignedReceipt {
  const json = JSON.parse(text) as { transmissionIndicator?: number; ftStateData?: { GR?: { GovernmentApi?: { ProtocolResponse?: string } } }; ftSignatures?: { caption?: string; data?: string }[] };
  const protocol = json.ftStateData?.GR?.GovernmentApi?.ProtocolResponse ?? "";
  const mark = tag(protocol, "invoiceMark");
  if (!mark) {
    const reason = tag(protocol, "message") ?? json.ftSignatures?.map((s) => s.data).filter(Boolean).join(" · ") ?? "";
    throw new VivaSignError(`Η ΑΑΔΕ δεν έδωσε MARK (ένδειξη ${json.transmissionIndicator ?? "—"})${reason ? `: ${reason.slice(0, 300)}` : ""}`);
  }
  return { mark, uid: tag(protocol, "invoiceUid"), authCode: tag(protocol, "authenticationCode"), qrUrl: tag(protocol, "qrUrl")?.replaceAll("&amp;", "&"), pdfUrl: text.match(/downloadingInvoiceUrl>([^<]+)</)?.[1], raw: json };
}

/** body: το fiscalisationData σε JSON με τα Int64 ως γυμνούς αριθμούς (toVivaJson). merchantId κενό = λογαριασμός της πλατφόρμας. */
export async function signReceipt(body: string, merchantId: string | null): Promise<SignedReceipt> {
  // φόρτωση μόνο σε πραγματική κλήση: οι ρυθμίσεις ζουν στη βάση (το parseSignResponse ελέγχεται χωρίς αυτήν)
  const [{ platform, platformBearer }, { isv, isvBearer }] = await Promise.all([import("./checkout"), import("./cloud-terminal")]);
  const viaIsv = merchantId !== null;
  const api = viaIsv ? (await isv()).api : (await platform()).api;
  const url = viaIsv ? `${api}/fiscalization/v1/isv/receipts:sign?merchantId=${encodeURIComponent(merchantId)}` : `${api}/fiscalization/v1/receipts:sign`;
  const token = viaIsv ? await isvBearer() : await platformBearer();
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new VivaSignError(`Viva Fiscal: HTTP ${res.status} ${text.slice(0, 300)}`);
  return parseSignResponse(text);
}
