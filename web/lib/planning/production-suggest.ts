// Πρόταση παραγωγής ημέρας (μεταφορά του plan-suggest της παλιάς), σε ακέραιες βασικές μονάδες.
//
// Για κάθε γεύση, το βράδυ πριν από την ημέρα παραγωγής Π:
//   ζήτηση καταστήματος = Σ μέσος όρος κατανάλωσης ανά ημέρα εβδομάδας για τις ημέρες Π … (επόμενη Π − 1)
//   + ελάχιστο βιτρίνας − απόθεμα καταστήματος            → ανάγκη καταστήματος (όχι κάτω από 0)
//   + επιβεβαιωμένη χονδρική με παράδοση μέσα στις ίδιες ημέρες
//   − έτοιμο απόθεμα εργαστηρίου − ό,τι είναι ήδη στο πρόγραμμα (μετά την κανονική φύρα)
//   = καθαρή ανάγκη → ολόκληρες καραπίνες → μίγμα = έτοιμο ÷ (1 − κανονική φύρα).
// Ημέρες με εξάντληση = «λογοκριμένη» ζήτηση: max(πωλήσεις, μέσος όρος ημερών χωρίς εξάντληση).

const DAY_MS = 86_400_000;
export const WEEKDAY_GENITIVE = ["Κυριακής", "Δευτέρας", "Τρίτης", "Τετάρτης", "Πέμπτης", "Παρασκευής", "Σαββάτου"];
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayUtc = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

export type Dimension = "mass" | "volume" | "count";
/** Το μίγμα στρογγυλοποιείται προς τα πάνω: 10 g / 10 ml / 1 τεμάχιο (η παλιά: 0,01 kg). */
const MIX_STEP: Record<Dimension, number> = { mass: 10_000, volume: 10, count: 1 };

// ── ζήτηση ανά ημέρα εβδομάδας ────────────────────────────────────────────────

export interface DemandSample { consumption: number; stockout: boolean }
export interface DemandEstimate { avg: number; samples: number; stockouts: number; lowerBound: boolean }
export const EMPTY_DEMAND: DemandEstimate = { avg: 0, samples: 0, stockouts: 0, lowerBound: false };

/** avg σε ακέραιη βασική μονάδα (στρογγυλοποίηση στο τέλος, όχι ανά δείγμα). */
export function censoredDemand(samples: readonly DemandSample[]): DemandEstimate {
  const raw = censoredDemandRaw(samples);
  return { ...raw, avg: Math.round(raw.avg) };
}

/** Χωρίς στρογγυλοποίηση: για το μοντέλο καιρού, που δουλεύει με λόγους. */
export function censoredDemandRaw(samples: readonly DemandSample[]): DemandEstimate {
  const n = samples.length;
  if (!n) return EMPTY_DEMAND;
  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const clean = samples.filter((s) => !s.stockout);
  const stockouts = n - clean.length;
  if (!clean.length) return { avg: samples.reduce((a, s) => a + pos(s.consumption), 0) / n, samples: n, stockouts, lowerBound: true };
  const cleanAvg = clean.reduce((a, s) => a + pos(s.consumption), 0) / clean.length;
  const sum = samples.reduce((a, s) => a + (s.stockout ? Math.max(pos(s.consumption), cleanAvg) : pos(s.consumption)), 0);
  return { avg: sum / n, samples: n, stockouts, lowerBound: false };
}

// ── ημέρες παραγωγής ──────────────────────────────────────────────────────────

/** Ημέρες εβδομάδας (0 = Κυριακή) με παραγωγή σε ≥ minHits από τις τελευταίες `weeks` εβδομάδες· null = λίγο ιστορικό. */
export function productionWeekdays(batchDays: readonly string[], refDay: string, weeks = 8, minHits = 2): number[] | null {
  const from = addDays(refDay, -weeks * 7);
  const days = new Set(batchDays.filter((d) => d >= from && d < refDay));
  if (days.size < minHits * 2) return null;
  const hits = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) hits[weekdayUtc(d)]! += 1;
  const out = hits.flatMap((h, wd) => (h >= minHits ? [wd] : []));
  return out.length ? out : null;
}

export function nextProductionDay(day: string, weekdays: readonly number[] | null): string {
  if (!weekdays?.length) return addDays(day, 1);
  for (let i = 1; i <= 7; i++) if (weekdays.includes(weekdayUtc(addDays(day, i)))) return addDays(day, i);
  return addDays(day, 1);
}

/** Ημέρες που καλύπτει η παραγωγή της `day`: έως πριν από την επόμενη ημέρα παραγωγής. */
export function coverageDays(day: string, weekdays: readonly number[] | null): string[] {
  const next = nextProductionDay(day, weekdays);
  const out: string[] = [];
  for (let d = day; d < next && out.length < 7; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [day];
}

export const isProductionDay = (day: string, weekdays: readonly number[] | null) => !weekdays || weekdays.includes(weekdayUtc(day));

// ── πρόταση ───────────────────────────────────────────────────────────────────

export interface SuggestInput {
  dimension: Dimension;
  shopDays: readonly { day: string; demand: DemandEstimate }[];
  shopStock: number;
  minShowcase: number;
  wholesale: readonly { day: string; qty: number }[];
  labStock: number;
  /** ήδη προγραμματισμένο μίγμα για την ημέρα */
  alreadyPlanned: number;
  /** κανονική φύρα %, 0–50 */
  lossPct: number;
  /** χωρητικότητα καραπίνας σε έτοιμο προϊόν (βασική μονάδα) */
  containerCap?: number | null;
  containerName?: string | null;
  /** χωρητικότητα κύκλου μηχανήματος σε μίγμα (βασική μονάδα) */
  batchCap?: number | null;
}

export type SuggestPartKey = "avg" | "stock" | "min" | "wholesale" | "lab" | "planned";
export interface SuggestPart { key: SuggestPartKey; sign: 1 | -1; qty: number; day?: string; demand?: DemandEstimate }
export interface Suggestion {
  parts: SuggestPart[];
  need: number;
  output: number;
  mix: number;
  containers: number | null;
  containerName: string | null;
  cycles: number | null;
  batchCap: number | null;
  lossPct: number;
  stockouts: number;
  lowerBound: boolean;
}

export function suggestProduction(input: SuggestInput): Suggestion {
  const parts: SuggestPart[] = [];
  let demand = 0, stockouts = 0, lowerBound = false;
  for (const d of input.shopDays) {
    if (d.demand.avg > 0) parts.push({ key: "avg", sign: 1, qty: d.demand.avg, day: d.day, demand: d.demand });
    demand += Math.max(0, d.demand.avg);
    stockouts += d.demand.stockouts;
    lowerBound ||= d.demand.lowerBound;
  }
  const shopStock = Math.max(0, input.shopStock), minShowcase = Math.max(0, input.minShowcase);
  if (shopStock > 0) parts.push({ key: "stock", sign: -1, qty: shopStock });
  if (minShowcase > 0) parts.push({ key: "min", sign: 1, qty: minShowcase });
  const shopNeed = Math.max(0, demand + minShowcase - shopStock);

  let wholesale = 0;
  for (const w of input.wholesale) {
    if (!(w.qty > 0)) continue;
    parts.push({ key: "wholesale", sign: 1, qty: w.qty, day: w.day });
    wholesale += w.qty;
  }

  const lossPct = Math.min(50, Math.max(0, input.lossPct || 0));
  const lab = Math.max(0, input.labStock);
  const planned = Math.round(Math.max(0, input.alreadyPlanned) * (100 - lossPct) / 100);
  // Το έτοιμο του εργαστηρίου και το ήδη προγραμματισμένο αφαιρούνται μόνο αν υπάρχει ανάγκη.
  const gross = shopNeed + wholesale;
  if (gross > 0 && lab > 0) parts.push({ key: "lab", sign: -1, qty: Math.min(lab, gross) });
  if (gross - lab > 0 && planned > 0) parts.push({ key: "planned", sign: -1, qty: Math.min(planned, gross - lab) });
  const need = Math.max(0, gross - lab - planned);

  const cap = input.dimension !== "count" && input.containerCap && input.containerCap > 0 ? input.containerCap : null;
  let output = need, containers: number | null = null;
  if (need > 0 && cap) {
    containers = Math.ceil(need / cap);
    output = containers * cap;
  }
  const step = MIX_STEP[input.dimension];
  const mix = output > 0 ? Math.ceil(output * 100 / (100 - lossPct) / step) * step : 0;
  const bc = input.batchCap && input.batchCap > 0 ? input.batchCap : null;
  return { parts, need, output, mix, containers, containerName: cap ? (input.containerName ?? null) : null, cycles: bc && mix > 0 ? Math.ceil(mix / bc) : null, batchCap: bc, lossPct, stockouts, lowerBound };
}

/** «2 καραπίνες» ή «2 × Λεκάνη 5L» όταν η καραπίνα έχει δικό της όνομα. */
export function containersLabel(n: number, name: string | null | undefined): string {
  const nm = name?.trim();
  if (nm && !/^καραπ/i.test(nm)) return `${n} × ${nm}`;
  return `${n} ${n === 1 ? "καραπίνα" : "καραπίνες"}`;
}

const PART_LABEL: Record<Exclude<SuggestPartKey, "avg">, string> = { stock: "απόθεμα", min: "ελάχιστο βιτρίνας", wholesale: "χονδρική", lab: "εργαστήριο", planned: "ήδη στο πρόγραμμα" };

/** «μ.ο. Τρίτης 6,2 kg − απόθεμα 1,8 + χονδρική 3,0 … → 2 καραπίνες». `fmt` δέχεται βασική μονάδα. */
export function breakdownLine(s: Suggestion, fmt: (base: number) => string, unit: string): string {
  const label = (p: SuggestPart) => (p.key === "avg" ? `μ.ο. ${p.day ? WEEKDAY_GENITIVE[weekdayUtc(p.day)] : ""}`.trim() : PART_LABEL[p.key]);
  const bits = s.parts.map((p, i) => {
    const txt = `${label(p)} ${fmt(p.qty)}${i === 0 ? ` ${unit}` : ""}`;
    return i === 0 ? (p.sign < 0 ? `− ${txt}` : txt) : `${p.sign < 0 ? "−" : "+"} ${txt}`;
  });
  let tail = s.output <= 0 ? "→ δεν χρειάζεται" : s.containers ? `→ ${containersLabel(s.containers, s.containerName)} (${fmt(s.output)} ${unit})` : `→ ${fmt(s.output)} ${unit}`;
  if (s.output > 0 && s.lossPct > 0) tail += ` · μίγμα ${fmt(s.mix)} ${unit} (φύρα ${s.lossPct.toFixed(1).replace(".", ",")}%)`;
  return [...bits, tail].join(" ");
}
