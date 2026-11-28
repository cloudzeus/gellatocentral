// Παραλαβή με σάρωση: ποια γραμμή παραγγελίας είναι ένα barcode, πόσα σαρώθηκαν, τι στέλνουμε στον server.
// Καθαρές συναρτήσεις, δοκιμάζονται με node --test.
import { parseGs1 } from "./gs1.ts";

export type Spot = { id: string; name: string };
/** spot: πού μπαίνει το υλικό στην αποθήκη της παραγγελίας (null = δεν έχει οριστεί). */
export type ReceivingLine = { id: string; genericItemId: string; name: string; dimension: string; missing: number; ordered: number; packBase: number; codes: { code: string; base: number }[]; expectedAt: string | null; spot?: Spot | null };
export type ReceivingOrder = { id: string; number: string; createdAt: string; warehouse?: { id: string; name: string }; spots?: Spot[]; supplier: { id: string; name: string; vatNumber: string | null; phones: SupplierPhone[] }; lines: ReceivingLine[] };
export type SupplierPhone = { who: string; label: string | null; phone: string };
export type NoteLine = { description: string; quantity: number; genericItemId: string | null; base: number | null };
export type DeliveryNote = { number: string | null; date: string | null; mark: string | null; vatNumber: string | null; supplier: { id: string; name: string } | null; lines: NoteLine[]; already?: { orderNumber: string; at: string; by: string; message: string } | null };
export type Counted = { base: number; batch?: string; expiry?: string };
export type Hit = { lineId: string; base: number; batch?: string; expiry?: string };

/** Barcode → γραμμή και πόσες βασικές μονάδες προσθέτει. undefined = δεν ανήκει στην παραγγελία. */
export function matchScan(raw: string, lines: readonly ReceivingLine[]): Hit | undefined {
  const scan = parseGs1(raw);
  const candidates = [scan?.gtin, scan?.ean, raw.trim()].filter((x): x is string => !!x);
  for (const c of candidates)
    for (const l of lines) {
      const code = l.codes.find((k) => k.code === c);
      if (code) return { lineId: l.id, base: code.base, batch: scan?.batch, expiry: scan?.expiry?.toISOString().slice(0, 10) };
    }
  return undefined;
}

/** Προσθέτει μία σάρωση· η πρώτη παρτίδα/λήξη της γραμμής κρατιέται. */
export function addScan(counted: Readonly<Record<string, Counted>>, hit: Hit): Record<string, Counted> {
  const was = counted[hit.lineId];
  return { ...counted, [hit.lineId]: { base: (was?.base ?? 0) + hit.base, batch: was?.batch ?? hit.batch, expiry: was?.expiry ?? hit.expiry } };
}

/** Πόσα γράφει το δελτίο για τη γραμμή (βασικές μονάδες), αν διαβάστηκε. */
export const noteBase = (note: DeliveryNote | null, l: ReceivingLine) =>
  note?.lines.filter((n) => n.genericItemId === l.genericItemId && n.base).reduce((s, n) => s + n.base!, 0) || null;

/** Πόσες γραμμές του δελτίου ταιριάζουν με την παραγγελία: διαλέγει την παραγγελία. */
export const noteMatches = (note: DeliveryNote | null, o: ReceivingOrder) => o.lines.filter((l) => noteBase(note, l)).length;

export type Decision = "wait" | "close";

/** Το σώμα της καταχώρισης. Ποτέ πάνω από όσα λείπουν· για όσα μένουν, η απόφαση wait/close. */
export function submission(order: ReceivingOrder, counted: Readonly<Record<string, Counted>>, decisions: Readonly<Record<string, Decision>>, note: DeliveryNote | null) {
  const lines = order.lines.filter((l) => counted[l.id]?.base).map((l) => ({
    orderLineId: l.id, quantityBase: Math.min(counted[l.id].base, l.missing), batchNumber: counted[l.id].batch ?? null, expiresAt: counted[l.id].expiry ?? null,
  }));
  const shortfall = order.lines.filter((l) => (counted[l.id]?.base ?? 0) < l.missing).map((l) => ({ orderLineId: l.id, action: decisions[l.id] ?? "wait" }));
  const fewer = order.lines.filter((l) => { const n = noteBase(note, l); return n && (counted[l.id]?.base ?? 0) < n; }).map((l) => l.name);
  return {
    orderId: order.id, lines, shortfall,
    deliveryNote: note ? { number: note.number, date: note.date?.slice(0, 10) ?? null, mark: note.mark } : undefined,
    remark: fewer.length ? `Λιγότερα από το δελτίο: ${fewer.join(", ")}` : undefined,
  };
}

/** Ποσότητα σε συσκευασίες για την οθόνη (π.χ. κιβώτια), στρογγυλή προς τα κάτω. */
export const packs = (base: number, packBase: number) => Math.floor(base / Math.max(1, packBase));

/** Τακτοποίηση μετά την παραλαβή: τα υλικά ανά θέση (αλφαβητικά), όσα δεν έχουν θέση στο τέλος. */
export function putaway<T extends { name: string; spot?: Spot | null }>(rows: readonly T[]): { spot: Spot | null; items: T[] }[] {
  const groups = new Map<string, { spot: Spot | null; items: T[] }>();
  for (const r of rows) {
    const k = r.spot?.id ?? "";
    const g = groups.get(k) ?? { spot: r.spot ?? null, items: [] };
    g.items.push(r);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => (!a.spot ? 1 : !b.spot ? -1 : a.spot.name.localeCompare(b.spot.name, "el")));
}
