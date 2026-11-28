// Οθόνη κουζίνας χωρίς βάση: από τις αποστολές στα δελτία (γύρος × σταθμός), τα σύνολα και ο χρόνος ανά ώρα.
// Mockup: docs/analysis/mockups/kitchen-display.html. Είδος που σερβιρίστηκε χωρίς «έτοιμο» μετρά ως έτοιμο: έφυγε από την κουζίνα.

export type Station = "KITCHEN" | "BAR";
export type KLine = { id: string; name: string; quantity: number; options: unknown; note: string | null; seat: number | null; readyAt: Date | null; servedAt?: Date | null; voidedAt: Date | null; station: Station | null };
export type KRound = { id: string; number: number; sentAt: Date; sentByName: string | null; table: string | null; label: string | null; waiter: string | null; lines: KLine[] };
export type Ticket = {
  key: string; roundId: string; station: Station; number: number; title: string; waiter: string | null; sentAt: Date;
  lines: { id: string; name: string; quantity: number; options: string; note: string | null; seat: number | null; ready: boolean; voided: boolean }[];
};

const optText = (o: unknown) => {
  const n = new Map<string, number>();
  for (const x of Array.isArray(o) ? o : []) if (x && typeof x === "object" && "name" in x) n.set(String(x.name), (n.get(String(x.name)) ?? 0) + 1);
  return [...n].map(([k, c]) => (c > 1 ? `${c}× ${k}` : k)).join(", ");
};

/**
 * Ένα δελτίο ανά γύρο και σταθμό, όσο έχει έστω ένα είδος που δεν ακυρώθηκε και δεν είναι έτοιμο. Τα ακυρωμένα μένουν
 * ορατά (κόκκινα) μέσα στο δελτίο ώσπου να κλείσει. only: μόνο αυτός ο σταθμός. Παλαιότερο πρώτο.
 */
export function tickets(rounds: KRound[], only?: Station | null): Ticket[] {
  const out: Ticket[] = [];
  for (const r of rounds)
    for (const station of ["KITCHEN", "BAR"] as const) {
      if (only && only !== station) continue;
      const ls = r.lines.filter((l) => l.station === station);
      if (!ls.some((l) => !l.voidedAt && !l.readyAt && !l.servedAt)) continue;
      out.push({
        key: `${r.id}:${station}`, roundId: r.id, station, number: r.number, title: r.table ? `Τ${r.table}` : r.label ?? "Λογαριασμός", waiter: r.waiter ?? r.sentByName, sentAt: r.sentAt,
        lines: ls.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, options: optText(l.options), note: l.note, seat: l.seat, ready: !!(l.readyAt || l.servedAt), voided: !!l.voidedAt })),
      });
    }
  return out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

/** «Να φτιαχτούν συνολικά»: ό,τι μένει σε όλα τα δελτία, ανά είδος, τα περισσότερα πρώτα. */
export function totals(ts: Ticket[]) {
  const m = new Map<string, number>();
  for (const t of ts) for (const l of t.lines) if (!l.ready && !l.voided) m.set(l.name, (m.get(l.name) ?? 0) + l.quantity);
  return [...m].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "el"));
}

/** Γραμμές που βγήκαν σήμερα: ο χρόνος ενός δελτίου = από την αποστολή ως το τελευταίο «έτοιμο» του. */
export type DoneLine = { roundId: string; station: Station; sentAt: Date; readyAt: Date };

/** Δελτία που βγήκαν, μέσος χρόνος, πόσα άργησαν και μέσος χρόνος ανά ώρα (τοπική ώρα του server). */
export function stats(lines: DoneLine[], lateMin: number) {
  const byTicket = new Map<string, { sentAt: Date; readyAt: Date }>();
  for (const l of lines) {
    const k = `${l.roundId}:${l.station}`;
    const t = byTicket.get(k);
    if (!t || l.readyAt > t.readyAt) byTicket.set(k, { sentAt: l.sentAt, readyAt: l.readyAt });
  }
  const mins = [...byTicket.values()].map((t) => ({ hour: t.sentAt.getHours(), min: Math.max(0, (t.readyAt.getTime() - t.sentAt.getTime()) / 60000) }));
  const hours = new Map<number, number[]>();
  for (const m of mins) hours.set(m.hour, [...(hours.get(m.hour) ?? []), m.min]);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    count: mins.length,
    avgMin: avg(mins.map((m) => m.min)),
    late: mins.filter((m) => m.min > lateMin).length,
    byHour: [...hours].sort((a, b) => a[0] - b[0]).map(([hour, xs]) => ({ hour, avgMin: avg(xs), count: xs.length })),
  };
}
