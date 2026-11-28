// Οθόνη κουζίνας χωρίς React: χρώμα ανά αναμονή, σύνολα και μετρήσεις ανά σταθμό. Mockup: docs/analysis/mockups/kitchen-display.html.
import type { KTicket, Station } from "./kitchen-api";

/** Πράσινο ως warn λεπτά, κίτρινο ως late, κόκκινο μετά. */
export const ageLevel = (min: number, warn: number, late: number): "ok" | "wait" | "bad" => (min >= late ? "bad" : min >= warn ? "wait" : "ok");

export const STATION_NAME: Record<Station, string> = { KITCHEN: "Κουζίνα", BAR: "Bar" };

/** Ό,τι μένει να φτιαχτεί στα δελτία, ανά είδος, τα περισσότερα πρώτα. */
export function totalsOf(ts: KTicket[]) {
  const m = new Map<string, number>();
  for (const t of ts) for (const l of t.lines) if (!l.ready && !l.voided) m.set(l.name, (m.get(l.name) ?? 0) + l.quantity);
  return [...m].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "el"));
}

/** Δελτία και είδη που περιμένουν, για τη γραμμή πάνω. */
export const waiting = (ts: KTicket[]) => ({ tickets: ts.length, items: totalsOf(ts).reduce((s, x) => s + x.quantity, 0) });
