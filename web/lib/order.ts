// Κανόνες παραγγελιών εκτός καταστήματος, χωρίς βάση (για tests): μεταβάσεις κατάστασης, «τι παίρνει συνήθως».
export type OrderStatus = "NEW" | "ACCEPTED" | "READY" | "OUT" | "DELIVERED" | "REJECTED" | "CANCELLED";

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["READY", "CANCELLED"],
  READY: ["OUT", "DELIVERED", "CANCELLED"], // παραλαβή: από «έτοιμη» κατευθείαν «παραδόθηκε»
  OUT: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const canMove = (from: OrderStatus, to: OrderStatus, delivery: boolean) =>
  NEXT[from].includes(to) && !(to === "OUT" && !delivery);

export const isActive = (s: OrderStatus) => s === "NEW" || s === "ACCEPTED" || s === "READY" || s === "OUT";

/** Τα είδη που παίρνει συχνότερα κάποιος: σε πόσες από τις επισκέψεις του υπήρχε το καθένα. */
export function usualItems(visits: { productId: string | null; name: string; quantity: number }[][], top = 4) {
  const seen = new Map<string, { name: string; visits: number; quantity: number }>();
  for (const lines of visits) {
    const once = new Set<string>();
    for (const l of lines) {
      const key = l.productId ?? `name:${l.name}`;
      const row = seen.get(key) ?? { name: l.name, visits: 0, quantity: 0 };
      row.quantity += l.quantity;
      if (!once.has(key)) { row.visits += 1; once.add(key); }
      seen.set(key, row);
    }
  }
  return [...seen.entries()]
    .map(([key, r]) => ({ productId: key.startsWith("name:") ? null : key, ...r }))
    .sort((a, b) => b.visits - a.visits || b.quantity - a.quantity)
    .slice(0, top);
}

/** Παραγγελίες ανά μήνα για το γράφημα της καρτέλας: οι τελευταίοι `months` μήνες, ο τρέχων τελευταίος. */
export function perMonth(dates: Date[], now: Date, months = 6) {
  const key = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }).slice(0, 7);
  const out: { month: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    out.push({ month: key(d), count: 0 });
  }
  for (const d of dates) { const row = out.find((r) => r.month === key(d)); if (row) row.count++; }
  return out;
}

/** Απόσταση σε μέτρα (haversine), για «1,2 χλμ από το κατάστημα». */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}
