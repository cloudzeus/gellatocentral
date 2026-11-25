import { createHash } from "node:crypto";

export type PricedList = {
  id: string;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  parties: { partyId: string }[];
  items: { genericItemId: string; unitPriceCents: number; vatRate: number }[];
};

/** Ειδικός τιμοκατάλογος πελάτη > γενικός· στην ίδια κατηγορία νικά ο πιο πρόσφατος ισχύων. */
export function selectPriceList(lists: readonly PricedList[], customerId: string, genericItemId: string, at: Date) {
  const candidates = lists.filter((list) => list.active && list.validFrom <= at && (!list.validTo || list.validTo >= at) && list.items.some((item) => item.genericItemId === genericItemId));
  const specific = candidates.filter((list) => list.parties.some((party) => party.partyId === customerId));
  const general = candidates.filter((list) => list.parties.length === 0);
  const pool = specific.length ? specific : general;
  const selected = [...pool].sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime() || b.id.localeCompare(a.id))[0];
  const item = selected?.items.find((row) => row.genericItemId === genericItemId);
  return selected && item ? { priceListId: selected.id, genericItemId, unitPriceCents: item.unitPriceCents, vatRate: item.vatRate } : null;
}

export function outstandingCents(document: { totalCents: number; status: string; docType: string }, allocations: readonly { amountCents: number }[]) {
  if (document.status !== "ISSUED" || document.docType !== "1.1") return 0;
  return Math.max(0, document.totalCents - allocations.reduce((sum, row) => sum + row.amountCents, 0));
}

export function paymentUnappliedCents(amountCents: number, allocations: readonly { amountCents: number }[]) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || allocations.some((row) => !Number.isSafeInteger(row.amountCents) || row.amountCents < 1)) throw new Error("Άκυρα ποσά είσπραξης");
  const applied = allocations.reduce((sum, row) => sum + row.amountCents, 0);
  if (applied > amountCents) throw new Error("Οι αντιστοιχίσεις υπερβαίνουν την είσπραξη");
  return amountCents - applied;
}

export function hashAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function validExternalKey(value: string) {
  return /^[-_a-zA-Z0-9]{8,100}$/.test(value);
}

export type WholesaleQuoteLifecycleStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
const QUOTE_TRANSITIONS: Record<WholesaleQuoteLifecycleStatus, readonly WholesaleQuoteLifecycleStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** Το ACCEPTED μένει τερματικό· η μετατροπή καταγράφεται ξεχωριστά και δεν σβήνει την απόφαση. */
export function canWholesaleQuoteTransition(from: WholesaleQuoteLifecycleStatus, to: WholesaleQuoteLifecycleStatus) {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function wholesaleQuoteExpired(status: WholesaleQuoteLifecycleStatus, validUntil: Date, at: Date) {
  return status === "SENT" && validUntil.getTime() <= at.getTime();
}

/** Μόνο τα παγωμένα επιχειρησιακά δεδομένα περνούν στην παραγγελία· τίποτα δεν ξανατιμολογείται από τιμοκατάλογο. */
export function wholesaleQuoteOrderInput(quote: {
  customerId: string;
  storeId: string;
  warehouseId: string;
  neededAt: Date | null;
  note: string | null;
  lines: readonly { genericItemId: string; quantityBase: number; unitPriceCents: number; vatRate: number }[];
}) {
  return {
    customerId: quote.customerId,
    storeId: quote.storeId,
    warehouseId: quote.warehouseId,
    neededAt: quote.neededAt,
    note: quote.note,
    externalKey: null,
    lines: quote.lines.map((line) => ({
      genericItemId: line.genericItemId,
      quantityBase: line.quantityBase,
      unitPriceCents: line.unitPriceCents,
      vatRate: line.vatRate,
    })),
  };
}
