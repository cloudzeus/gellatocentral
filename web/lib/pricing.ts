// ΜΟΝΑΔΙΚΗ πηγή τιμών συνδρομής. Λεπτά του ευρώ, προ ΦΠΑ, ανά μήνα.
// Χρέωση: ανά κατάστημα + ανά ενεργή συσκευή τιμολόγησης.
// ΠΡΟΣΟΧΗ: οι τιμές είναι προσωρινές (δεν έχουν αποφασιστεί) — άλλαξέ τες μόνο εδώ.
export const PRICE_PER_STORE = 5900;
export const PRICE_PER_DEVICE = 1500;

/** Μόνο οι συσκευές που εκδίδουν παραστατικά χρεώνονται (όχι π.χ. η οθόνη κουζίνας). */
export const BILLABLE_KINDS = ["POS_WEB", "POS_ANDROID"] as const;
export const isBillable = (kind: string) => (BILLABLE_KINDS as readonly string[]).includes(kind);

export function monthlyCharge(stores: number, devices: number) {
  if (!Number.isInteger(stores) || !Number.isInteger(devices) || stores < 0 || devices < 0)
    throw new RangeError("Το πλήθος καταστημάτων και συσκευών πρέπει να είναι μη αρνητικός ακέραιος");
  const storesCents = stores * PRICE_PER_STORE;
  const devicesCents = devices * PRICE_PER_DEVICE;
  return { storesCents, devicesCents, totalCents: storesCents + devicesCents };
}
