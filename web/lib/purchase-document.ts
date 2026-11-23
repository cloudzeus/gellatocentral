// Καθαρή λογική παρουσίασης και υπολογισμού τιμολογίου αγοράς.
// Τα ποσά παραμένουν ακέραια λεπτά· ΦΠΑ και εκπτώσεις στρογγυλοποιούνται ανά γραμμή.
// Τα snapshots εμποδίζουν μια μεταγενέστερη αλλαγή καρτέλας να ξαναγράψει ιστορικό παραστατικό.

export type DocumentParty = {
  name: string;
  tradeName: string | null;
  vatNumber: string | null;
  taxOffice: string | null;
  profession: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
};

export type PartySnapshotInput = Partial<Omit<DocumentParty, "name">> & { name: string };
export type PurchaseLineAmounts = { quantity: number; unitPriceCents: number; discountBps: number; vatRate: number };
export type PurchaseExpenses = { shippingCostCents: number; otherExpensesCents: number; expensesVatRate: number };

export const partySnapshot = (party: PartySnapshotInput): DocumentParty => ({
  name: party.name,
  tradeName: party.tradeName ?? null,
  vatNumber: party.vatNumber ?? null,
  taxOffice: party.taxOffice ?? null,
  profession: party.profession ?? null,
  address: party.address ?? null,
  city: party.city ?? null,
  postalCode: party.postalCode ?? null,
  countryCode: party.countryCode ?? null,
  phone: party.phone ?? null,
  email: party.email ?? null,
});

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;

/** Διαβάζει Json της βάσης χωρίς να εμπιστεύεται τον τύπο του· για παλιά έγγραφα χρησιμοποιεί το fallback. */
export function documentParty(value: unknown, fallback: DocumentParty): DocumentParty {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  if (!name) return fallback;
  return {
    name,
    tradeName: text(raw.tradeName),
    vatNumber: text(raw.vatNumber),
    taxOffice: text(raw.taxOffice),
    profession: text(raw.profession),
    address: text(raw.address),
    city: text(raw.city),
    postalCode: text(raw.postalCode),
    countryCode: text(raw.countryCode),
    phone: text(raw.phone),
    email: text(raw.email),
  };
}

export function calculatePurchaseLine<T extends PurchaseLineAmounts>(line: T) {
  const grossCents = line.quantity * line.unitPriceCents;
  const discountCents = Math.round((grossCents * line.discountBps) / 10_000);
  const netCents = grossCents - discountCents;
  const vatCents = Math.round((netCents * line.vatRate) / 100);
  return { ...line, grossCents, discountCents, netCents, vatCents, totalCents: netCents + vatCents };
}

export function calculatePurchaseDocument<T extends PurchaseLineAmounts>(lines: readonly T[], expenses: PurchaseExpenses = { shippingCostCents: 0, otherExpensesCents: 0, expensesVatRate: 24 }) {
  const calculated = lines.map(calculatePurchaseLine);
  const chargesNetCents = expenses.shippingCostCents + expenses.otherExpensesCents;
  const chargesVatCents = Math.round((chargesNetCents * expenses.expensesVatRate) / 100);
  const groups = new Map<number, { vatRate: number; netCents: number; vatCents: number; totalCents: number }>();
  const add = (rate: number, net: number, vat: number) => {
    const group = groups.get(rate) ?? { vatRate: rate, netCents: 0, vatCents: 0, totalCents: 0 };
    group.netCents += net;
    group.vatCents += vat;
    group.totalCents += net + vat;
    groups.set(rate, group);
  };
  for (const line of calculated) add(line.vatRate, line.netCents, line.vatCents);
  if (chargesNetCents) add(expenses.expensesVatRate, chargesNetCents, chargesVatCents);
  const grossCents = calculated.reduce((sum, line) => sum + line.grossCents, 0);
  const discountCents = calculated.reduce((sum, line) => sum + line.discountCents, 0);
  const netCents = calculated.reduce((sum, line) => sum + line.netCents, 0);
  const vatCents = calculated.reduce((sum, line) => sum + line.vatCents, 0);
  return {
    lines: calculated,
    grossCents,
    discountCents,
    netCents,
    vatCents,
    chargesNetCents,
    chargesVatCents,
    totalNetCents: netCents + chargesNetCents,
    totalVatCents: vatCents + chargesVatCents,
    totalCents: netCents + chargesNetCents + vatCents + chargesVatCents,
    vat: [...groups.values()].sort((a, b) => b.vatRate - a.vatRate),
  };
}
