// Πρόβλεψη ζήτησης με βάση τον καιρό (μεταφορά του weather-forecast.ts + mrp-accuracy της παλιάς).
// Καθαρή λογική, χωρίς I/O. Οι ποσότητες είναι στη βασική μονάδα του είδους· το μοντέλο δουλεύει με λόγους,
// οπότε η μονάδα δεν το επηρεάζει. Η στρογγυλοποίηση σε ακέραια γίνεται στην έξοδο (DB/οθόνη).
//
// ζήτηση(Η) = βάση × συντελεστής ημέρας εβδομάδας(Η) × συντελεστής καιρού(Η)
//   συντελεστής καιρού = (1 + β)^h × (1 + γ αν βρέχει), h = max(0, μέγιστη − 20 °C) (έως 18), βροχή ≥ 1 mm
//   β, γ από παλινδρόμηση στο ιστορικό, με συρρίκνωση προς τις προεπιλογές (3,5 %/°C, −15 % βροχή)
//   βάση = μέσος όρος 28 ημερών χωρίς επίδραση ημέρας και καιρού (λογοκριμένες οι ημέρες εξάντλησης)
// Λίγα δεδομένα (< 60 ημέρες ή < 90 ημέρες εύρος) → «εκτίμηση». Χωρίς καιρό για την ημέρα → συντελεστής 1.
// Πάροχος: MET Norway Locationforecast 2.0 (δωρεάν και για εμπορική χρήση, CC BY 4.0).
import { censoredDemandRaw as censoredDemand, type DemandSample } from "./production-suggest.ts";

const DAY_MS = 86_400_000;

export const WEATHER_MODEL = {
  refTemp: 20,
  maxHeat: 18,
  rainMm: 1,
  defaultTempPct: 3.5,
  tempPctBounds: [0, 8] as const,
  defaultRainPct: -15,
  rainPctBounds: [-40, 0] as const,
  /** «Ισοδύναμες ημέρες» της προηγούμενης τιμής στη συρρίκνωση */
  shrinkWarmDays: 40,
  shrinkRainDays: 15,
  minWarmDays: 5,
  minRainDays: 3,
  lowDataDays: 60,
  seasonSpanDays: 90,
  baselineDays: 28,
  weekdayWeeks: 8,
  weekdayMinWeeks: 4,
  weekdayMaxFactor: 3,
  factorBounds: [0.4, 2.5] as const,
  historyDays: 400,
};

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── καιρός ──────────────────────────────────────────────────────────────────

export interface WeatherDay {
  day: string;
  tmax: number | null;
  tmin?: number | null;
  /** υετός mm */
  precip: number | null;
  precipProb?: number | null;
  sunshineH?: number | null;
  /** WMO weather code */
  code?: number | null;
}

export type WeatherKind = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm" | "unknown";

/** Κατηγορία εικονιδίου από τον κωδικό WMO */
export function weatherKind(code: number | null | undefined, precip?: number | null): WeatherKind {
  if (code === null || code === undefined || !Number.isFinite(code)) {
    if (precip !== null && precip !== undefined && precip >= WEATHER_MODEL.rainMm) return "rain";
    return "unknown";
  }
  if (code === 0) return "sun";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

export const WEATHER_KIND_LABEL: Record<WeatherKind, string> = {
  sun: "Ηλιοφάνεια",
  partly: "Λίγα σύννεφα",
  cloud: "Συννεφιά",
  fog: "Ομίχλη",
  rain: "Βροχή",
  snow: "Χιόνι",
  storm: "Καταιγίδα",
  unknown: "Χωρίς στοιχεία",
};

// ── πάροχος καιρού ──────────────────────────────────────────────────────────
// MET Norway: θέλει User-Agent με στοιχεία επικοινωνίας, σεβασμό Expires/If-Modified-Since, ≤ 4 δεκαδικά.

export type WeatherProvider = "met-no";

export const WEATHER_ATTRIBUTION: Record<WeatherProvider, string> = {
  "met-no": "Δεδομένα καιρού: MET Norway (CC BY 4.0)",
};

/** Συντεταγμένες με το πολύ 4 δεκαδικά (όρος χρήσης MET Norway) */
export const coord4 = (v: number) => String(Math.round(v * 10000) / 10000);

export const metNoUrl = (lat: number, lon: number) =>
  `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${coord4(lat)}&lon=${coord4(lon)}`;

/** Σύμβολο MET Norway (π.χ. «lightrainshowers_day») → κωδικός WMO για τα εικονίδια */
export function metSymbolToWmo(symbol: string | null | undefined): number | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (s.includes("thunder")) return 95;
  if (s.includes("sleet")) return 66;
  if (s.includes("snow")) return s.startsWith("heavy") ? 75 : s.startsWith("light") ? 71 : 73;
  if (s.includes("rain")) return s.includes("showers") ? 80 : s.startsWith("heavy") ? 65 : s.startsWith("light") ? 61 : 63;
  if (s === "fog") return 45;
  if (s === "cloudy") return 3;
  if (s === "partlycloudy") return 2;
  if (s === "fair") return 1;
  if (s === "clearsky") return 0;
  return null;
}

/** Βαρύτητα κωδικού για την επιλογή του «χειρότερου» συμβόλου της ημέρας */
const wmoRank = (c: number) => (c >= 95 ? 6 : c >= 71 && c <= 77 ? 5 : c >= 61 ? 4 : c >= 51 ? 3 : c === 45 ? 2 : c);

/** Τοπική ημερομηνία (ζώνη ώρας) μιας στιγμής ISO */
export function localDay(iso: string, tz = "Europe/Athens"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const localHour = (iso: string, tz: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));

/**
 * MET Norway compact → ημερήσια (τοπική ημέρα): μέγιστη/ελάχιστη από τις ωριαίες θερμοκρασίες,
 * υετός = Σ next_1_hours (όπου λείπει, next_6_hours μόνο για τα 6ωρα που δεν καλύφθηκαν), σύμβολο =
 * το πιο «βαρύ» της ημέρας (07–22). Ημέρες με λιγότερες από 4 ώρες δεδομένων παραλείπονται, και η
 * σημερινή επισημαίνεται `partial` όταν λείπουν οι πρωινές ώρες (η μέγιστη μπορεί να υποεκτιμάται).
 */
export function parseMetNoDaily(json: unknown, tz = "Europe/Athens"): Array<WeatherDay & { hours: number; partial: boolean }> {
  const ts = (json as { properties?: { timeseries?: unknown[] } } | null)?.properties?.timeseries;
  if (!Array.isArray(ts)) return [];
  type Acc = { tmax: number | null; tmin: number | null; precip: number; hasPrecip: boolean; code: number | null; hours: number; firstHour: number; covered: Set<number> };
  const days = new Map<string, Acc>();
  for (const e of ts) {
    const o = e as { time?: string; data?: Record<string, { details?: Record<string, unknown>; summary?: { symbol_code?: string } }> };
    if (typeof o.time !== "string" || !o.data) continue;
    const day = localDay(o.time, tz);
    const h = localHour(o.time, tz);
    const a = days.get(day) ?? { tmax: null, tmin: null, precip: 0, hasPrecip: false, code: null, hours: 0, firstHour: h, covered: new Set<number>() };
    const t = fin(o.data["instant"]?.details?.["air_temperature"]);
    if (t !== null) {
      a.tmax = a.tmax === null ? t : Math.max(a.tmax, t);
      a.tmin = a.tmin === null ? t : Math.min(a.tmin, t);
      a.hours += 1;
      a.firstHour = Math.min(a.firstHour, h);
    }
    const n1 = o.data["next_1_hours"];
    const n6 = o.data["next_6_hours"];
    const p1 = fin(n1?.details?.["precipitation_amount"]);
    if (p1 !== null) {
      a.precip += p1;
      a.hasPrecip = true;
      a.covered.add(h);
    } else {
      const p6 = fin(n6?.details?.["precipitation_amount"]);
      if (p6 !== null && ![0, 1, 2, 3, 4, 5].some((k) => a.covered.has(h + k))) {
        a.precip += p6;
        a.hasPrecip = true;
        for (let k = 0; k < 6; k++) a.covered.add(h + k);
      }
    }
    const sym = (n1 ?? n6)?.summary?.symbol_code;
    const c = metSymbolToWmo(sym);
    if (c !== null && h >= 7 && h <= 22 && (a.code === null || wmoRank(c) > wmoRank(a.code))) a.code = c;
    days.set(day, a);
  }
  const out: Array<WeatherDay & { hours: number; partial: boolean }> = [];
  for (const [day, a] of [...days].sort(([x], [y]) => x.localeCompare(y))) {
    if (a.hours < 4 || a.tmax === null) continue;
    out.push({
      day,
      tmax: Math.round(a.tmax * 10) / 10,
      tmin: a.tmin === null ? null : Math.round(a.tmin * 10) / 10,
      precip: a.hasPrecip ? Math.round(a.precip * 10) / 10 : null,
      precipProb: null,
      sunshineH: null,
      code: a.code,
      hours: a.hours,
      partial: a.firstHour > 10,
    });
  }
  return out;
}

/** Ημέρα που μόλις ξαναλήφθηκε σε συνδυασμό με την αποθηκευμένη: για τη σημερινή (μερική) κρατάμε τη μεγαλύτερη μέγιστη */
export function mergeDay(stored: WeatherDay | null | undefined, fresh: WeatherDay, partial: boolean): WeatherDay {
  if (!stored || !partial) return fresh;
  return {
    ...fresh,
    tmax: stored.tmax === null ? fresh.tmax : fresh.tmax === null ? stored.tmax : Math.max(stored.tmax, fresh.tmax),
    tmin: stored.tmin ?? fresh.tmin ?? null,
    precip: stored.precip === null ? fresh.precip : fresh.precip === null ? stored.precip : Math.max(stored.precip, fresh.precip),
    code: stored.code ?? fresh.code ?? null,
  };
}

// ── συντελεστής καιρού ──────────────────────────────────────────────────────

export interface Elasticity {
  /** % μεταβολής ανά °C πάνω από 20 °C */
  tempPct: number;
  /** % μεταβολής σε βροχερή ημέρα (αρνητικό) */
  rainPct: number;
  /** ημέρες με θερμοκρασία > 20 °C στο ιστορικό */
  warmDays: number;
  rainDays: number;
  /** βάρος των δεδομένων (0–1) έναντι της προηγούμενης τιμής */
  tempWeight: number;
  rainWeight: number;
  /** εκτίμηση πριν από τη συρρίκνωση (null = χωρίς αρκετά δεδομένα) */
  rawTempPct: number | null;
  rawRainPct: number | null;
}

export const DEFAULT_ELASTICITY: Elasticity = {
  tempPct: WEATHER_MODEL.defaultTempPct,
  rainPct: WEATHER_MODEL.defaultRainPct,
  warmDays: 0,
  rainDays: 0,
  tempWeight: 0,
  rainWeight: 0,
  rawTempPct: null,
  rawRainPct: null,
};

export const heatOf = (tmax: number | null | undefined) =>
  tmax === null || tmax === undefined || !Number.isFinite(tmax)
    ? 0
    : clamp(tmax - WEATHER_MODEL.refTemp, 0, WEATHER_MODEL.maxHeat);
export const isRainy = (precip: number | null | undefined) =>
  precip !== null && precip !== undefined && Number.isFinite(precip) && precip >= WEATHER_MODEL.rainMm;

export interface FactorParts {
  temp: number;
  rain: number;
  total: number;
  /** δεν υπάρχει καιρός για την ημέρα */
  missing: boolean;
}

export function weatherFactor(w: WeatherDay | null | undefined, e: Elasticity): FactorParts {
  if (!w || (w.tmax === null && w.precip === null)) return { temp: 1, rain: 1, total: 1, missing: true };
  const temp = Math.pow(1 + e.tempPct / 100, heatOf(w.tmax));
  const rain = isRainy(w.precip) ? 1 + e.rainPct / 100 : 1;
  const total = clamp(temp * rain, WEATHER_MODEL.factorBounds[0], WEATHER_MODEL.factorBounds[1]);
  return { temp, rain, total, missing: false };
}

// ── εκμάθηση ────────────────────────────────────────────────────────────────

export interface HistorySample {
  day: string;
  qty: number;
  stockout: boolean;
}

/** Λύση 3×3 (μικρά συστήματα· null αν είναι ιδιάζον) */
function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-9) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return [0, 1, 2].map((i) => m[i]![3]! / m[i]![i]!);
}

/**
 * Ελαστικότητα θερμοκρασίας/βροχής από το ιστορικό, με συρρίκνωση προς `prior`.
 * `wk` = συντελεστές ημέρας εβδομάδας (0 = Κυριακή) ή null.
 */
export function fitElasticity(
  samples: readonly HistorySample[],
  weather: ReadonlyMap<string, WeatherDay>,
  prior: Pick<Elasticity, "tempPct" | "rainPct"> = DEFAULT_ELASTICITY,
  wk: readonly number[] | null = null,
): Elasticity {
  const xs: Array<[number, number, number]> = [];
  for (const s of samples) {
    if (s.stockout || !(s.qty > 0)) continue;
    const w = weather.get(s.day);
    if (!w || w.tmax === null) continue;
    const f = wk ? wk[weekdayOf(s.day)] || 1 : 1;
    xs.push([heatOf(w.tmax), isRainy(w.precip) ? 1 : 0, Math.log(s.qty / f)]);
  }
  const warmDays = xs.filter((x) => x[0] > 0).length;
  const rainDays = xs.filter((x) => x[1] > 0).length;
  const M = WEATHER_MODEL;
  let rawT: number | null = null;
  let rawR: number | null = null;
  if (xs.length >= 10) {
    // χρειάζεται διακύμανση: διαφορετικές θερμοκρασίες / και βροχερές και στεγνές ημέρες
    const hs = new Set(xs.map((x) => Math.round(x[0] * 10)));
    const useT = warmDays >= M.minWarmDays && hs.size >= 3;
    const useR = rainDays >= M.minRainDays && rainDays < xs.length;
    if (useT || useR) {
      // Κανονικές εξισώσεις [1, h, βροχή]· στήλη χωρίς δεδομένα → σταθερή στην προηγούμενη τιμή
      const bT = Math.log(1 + prior.tempPct / 100);
      const bR = Math.log(1 + prior.rainPct / 100);
      const A = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const B = [0, 0, 0];
      for (const [h, r, y0] of xs) {
        const y = y0 - (useT ? 0 : bT * h) - (useR ? 0 : bR * r);
        const v = [1, useT ? h : 0, useR ? r : 0];
        for (let i = 0; i < 3; i++) {
          B[i]! += v[i]! * y;
          for (let j = 0; j < 3; j++) A[i]![j]! += v[i]! * v[j]!;
        }
      }
      if (!useT) A[1]![1] = 1;
      if (!useR) A[2]![2] = 1;
      const sol = solve3(A, B);
      if (sol) {
        if (useT) rawT = (Math.exp(sol[1]!) - 1) * 100;
        if (useR) rawR = (Math.exp(sol[2]!) - 1) * 100;
      }
    }
  }
  const tempWeight = rawT === null ? 0 : warmDays / (warmDays + M.shrinkWarmDays);
  const rainWeight = rawR === null ? 0 : rainDays / (rainDays + M.shrinkRainDays);
  const tB = M.tempPctBounds;
  const rB = M.rainPctBounds;
  const tempPct = clamp(
    tempWeight * clamp(rawT ?? 0, tB[0], tB[1]) + (1 - tempWeight) * clamp(prior.tempPct, tB[0], tB[1]),
    tB[0],
    tB[1],
  );
  const rainPct = clamp(
    rainWeight * clamp(rawR ?? 0, rB[0], rB[1]) + (1 - rainWeight) * clamp(prior.rainPct, rB[0], rB[1]),
    rB[0],
    rB[1],
  );
  return { tempPct, rainPct, warmDays, rainDays, tempWeight, rainWeight, rawTempPct: rawT, rawRainPct: rawR };
}

/**
 * Συντελεστές ημέρας εβδομάδας (0 = Κυριακή) από τις τελευταίες `weeks` εβδομάδες πριν από `end`
 * (συμπεριλαμβάνεται), σε ποσότητες χωρίς επίδραση καιρού. null = λιγότερες από 4 εβδομάδες.
 */
export function weekdayFactors(
  values: ReadonlyMap<string, number>,
  end: string,
  weeks = WEATHER_MODEL.weekdayWeeks,
): number[] | null {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  let weeksWith = 0;
  for (let w = 0; w < weeks; w++) {
    let any = false;
    for (let i = 0; i < 7; i++) {
      const d = addDays(end, -(w * 7 + i));
      const v = values.get(d);
      if (v === undefined) continue;
      any = true;
      sums[weekdayOf(d)]! += Math.max(0, v);
      counts[weekdayOf(d)]! += 1;
    }
    if (any) weeksWith += 1;
  }
  if (weeksWith < WEATHER_MODEL.weekdayMinWeeks) return null;
  const means = sums.map((s, i) => (counts[i] ? s / counts[i]! : NaN));
  const known = means.filter((m) => Number.isFinite(m));
  const overall = known.reduce((a, b) => a + b, 0) / Math.max(1, known.length);
  if (!(overall > 0)) return null;
  const raw = means.map((m) => (Number.isFinite(m) ? Math.min(WEATHER_MODEL.weekdayMaxFactor, m / overall) : 1));
  const rawMean = raw.reduce((a, b) => a + b, 0) / 7;
  return raw.map((f) => f / rawMean);
}

export interface SeriesModel {
  /** βάση: ημερήσια ζήτηση σε «κανονική» ημέρα (≤ 20 °C, χωρίς βροχή, μέση ημέρα εβδομάδας) */
  base: number;
  weekday: number[] | null;
  elasticity: Elasticity;
  historyDays: number;
  spanDays: number;
  lowData: boolean;
  /** όλα τα δείγματα της βάσης είχαν εξάντληση: η βάση είναι κατώτατο όριο */
  lowerBound: boolean;
  /** ημέρες με ασυνήθιστη τιμή (πιθανό λάθος απογραφής) που εξαιρέθηκαν */
  outliers: HistorySample[];
}

/**
 * Ασυνήθιστες τιμές κατανάλωσης (π.χ. λάθος πληκτρολόγηση στην απογραφή): αρνητικές ή πάνω από
 * max(διάμεσος × 5, διάμεσος + 6 × MAD) των θετικών τιμών της σειράς. Χρειάζονται ≥ 5 θετικές τιμές.
 */
export function splitOutliers(samples: readonly HistorySample[]): { kept: HistorySample[]; outliers: HistorySample[] } {
  const pos = samples.map((s) => s.qty).filter((q) => q > 0).sort((a, b) => a - b);
  const med = (xs: number[]) => (xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2) : 0);
  if (pos.length < 5) {
    const neg = samples.filter((s) => s.qty < 0);
    return { kept: samples.filter((s) => s.qty >= 0), outliers: neg };
  }
  const m = med(pos);
  const mad = med(pos.map((q) => Math.abs(q - m)).sort((a, b) => a - b));
  const limit = Math.max(m * 5, m + 6 * mad);
  const kept: HistorySample[] = [];
  const outliers: HistorySample[] = [];
  for (const s of samples) (s.qty < 0 || s.qty > limit ? outliers : kept).push(s);
  return { kept, outliers };
}

/** Μοντέλο μιας σειράς (γεύση × κατάστημα) με ιστορικό έως και `today − 1`. */
export function fitSeries(
  history: readonly HistorySample[],
  weather: ReadonlyMap<string, WeatherDay>,
  today: string,
  prior: Pick<Elasticity, "tempPct" | "rainPct"> = DEFAULT_ELASTICITY,
): SeriesModel {
  const M = WEATHER_MODEL;
  const inWindow = history.filter((s) => s.day < today && s.day >= addDays(today, -M.historyDays));
  // 0) εξαίρεση ασυνήθιστων τιμών (λάθη απογραφής) πριν από κάθε υπολογισμό
  const { kept: past, outliers } = splitOutliers(inWindow);
  // 1) πρώτη εκτίμηση ελαστικότητας χωρίς ημέρα εβδομάδας, για να «καθαρίσουμε» τον καιρό
  const e0 = fitElasticity(past, weather, prior, null);
  const deweather = (s: HistorySample, e: Elasticity) => s.qty / weatherFactor(weather.get(s.day), e).total;
  const end = addDays(today, -1);
  const wkVals = new Map<string, number>();
  for (const s of past) if (s.day > addDays(end, -M.weekdayWeeks * 7) && !s.stockout) wkVals.set(s.day, deweather(s, e0));
  const weekday = weekdayFactors(wkVals, end);
  // 2) τελική ελαστικότητα με τους συντελεστές ημέρας
  const elasticity = fitElasticity(past, weather, prior, weekday);
  // 3) βάση: τελευταίες 28 ημέρες χωρίς καιρό και ημέρα εβδομάδας
  const recent: DemandSample[] = past
    .filter((s) => s.day >= addDays(today, -M.baselineDays))
    .map((s) => ({
      consumption: deweather(s, elasticity) / (weekday ? weekday[weekdayOf(s.day)] || 1 : 1),
      stockout: s.stockout,
    }));
  const est = censoredDemand(recent);
  const days = new Set(past.map((s) => s.day));
  const first = past.reduce<string | null>((a, s) => (a === null || s.day < a ? s.day : a), null);
  const spanDays = first ? dayDiff(today, first) : 0;
  return {
    base: est.avg,
    weekday,
    elasticity,
    historyDays: days.size,
    spanDays,
    lowData: days.size < M.lowDataDays || spanDays < M.seasonSpanDays,
    lowerBound: est.lowerBound,
    outliers,
  };
}

export interface DayForecast {
  day: string;
  qty: number;
  base: number;
  weekdayFactor: number;
  weather: FactorParts;
  tmax: number | null;
}

export function forecastDay(model: SeriesModel, day: string, w: WeatherDay | null | undefined): DayForecast {
  const wkf = model.weekday ? model.weekday[weekdayOf(day)] || 1 : 1;
  const weather = weatherFactor(w, model.elasticity);
  return { day, qty: model.base * wkf * weather.total, base: model.base, weekdayFactor: wkf, weather, tmax: w?.tmax ?? null };
}

/**
 * Η σημερινή μέθοδος της εφαρμογής (για σύγκριση ακρίβειας): μέσος όρος των τελευταίων 4 ίδιων
 * ημερών εβδομάδας (λογοκριμένη ζήτηση), αλλιώς των τελευταίων 28 ημερών.
 */
export function plainWeekdayDemand(history: readonly HistorySample[], today: string, day: string, n = 4): number {
  const past = [...history].filter((s) => s.day < today).sort((a, b) => b.day.localeCompare(a.day));
  const wd = weekdayOf(day);
  const same = past.filter((s) => weekdayOf(s.day) === wd).slice(0, n);
  const src = same.length ? same : past.slice(0, 28);
  return censoredDemand(src.map((s) => ({ consumption: s.qty, stockout: s.stockout }))).avg;
}

/** Ελαστικότητα του καταστήματος από το σύνολο των γεύσεων ανά ημέρα (προηγούμενη τιμή για κάθε γεύση) */
export function storeElasticity(
  bySeries: ReadonlyArray<readonly HistorySample[]>,
  weather: ReadonlyMap<string, WeatherDay>,
  today: string,
): Elasticity {
  const totals = new Map<string, { qty: number; stockout: boolean }>();
  for (const list of bySeries)
    for (const s of list) {
      if (s.day >= today) continue;
      const cur = totals.get(s.day) ?? { qty: 0, stockout: false };
      cur.qty += Math.max(0, s.qty);
      totals.set(s.day, cur);
    }
  const samples = [...totals].map(([day, v]) => ({ day, qty: v.qty, stockout: false }));
  return fitElasticity(samples, weather, DEFAULT_ELASTICITY, null);
}

// ── πρόταση παραγωγής 7 ημερών ──────────────────────────────────────────────

export interface PlanInput {
  days: readonly string[];
  /** αναμενόμενη ζήτηση ανά ημέρα (όλα τα καταστήματα) */
  demand: readonly number[];
  /** απόθεμα τώρα: καταστήματα + έτοιμο εργαστηρίου */
  stock: number;
  /** ήδη προγραμματισμένο έτοιμο (μετά τη φύρα) ανά ημέρα */
  planned: readonly number[];
  /** ημέρες παραγωγής (0 = Κυριακή)· null = κάθε ημέρα */
  productionWeekdays: readonly number[] | null;
  dimension: "mass" | "volume" | "count";
  containerCap?: number | null;
  lossPct?: number;
}

export interface PlanDay {
  day: string;
  demand: number;
  planned: number;
  /** προτεινόμενο έτοιμο προϊόν (μετά τη στρογγυλοποίηση) */
  output: number;
  /** μίγμα = έτοιμο ÷ (1 − φύρα) */
  mix: number;
  containers: number | null;
  /** απόθεμα στο τέλος της ημέρας (αρνητικό = έλλειψη) */
  end: number;
  productionDay: boolean;
}

export function planWeek(input: PlanInput): PlanDay[] {
  const n = input.days.length;
  const isProd = (d: string) => !input.productionWeekdays || input.productionWeekdays.includes(weekdayOf(d));
  const cap = input.dimension !== "count" && input.containerCap && input.containerCap > 0 ? input.containerCap : null;
  const loss = clamp(input.lossPct ?? 0, 0, 50);
  let bal = Math.max(0, input.stock);
  const out: PlanDay[] = [];
  for (let i = 0; i < n; i++) {
    const day = input.days[i]!;
    const planned = Math.max(0, input.planned[i] ?? 0);
    bal += planned;
    let output = 0;
    let containers: number | null = null;
    const prod = isProd(day);
    if (prod) {
      // κάλυψη: έως πριν από την επόμενη ημέρα παραγωγής (μέσα στον ορίζοντα)
      let need = 0;
      for (let j = i; j < n; j++) {
        if (j > i && isProd(input.days[j]!)) break;
        need += Math.max(0, input.demand[j] ?? 0);
        need -= j > i ? Math.max(0, input.planned[j] ?? 0) : 0;
      }
      const short = need - bal;
      if (short > 1e-6) {
        if (cap) {
          containers = Math.ceil(short / cap - 1e-9);
          output = containers * cap;
        } else output = input.dimension === "count" ? Math.ceil(short - 1e-9) : Math.ceil(short);
        bal += output;
      }
    }
    const demand = Math.max(0, input.demand[i] ?? 0);
    bal -= demand;
    let mix = output > 0 && loss > 0 ? output / (1 - loss / 100) : output;
    mix = Math.ceil(mix - 1e-9);
    out.push({ day, demand, planned, output, mix: output > 0 ? mix : 0, containers, end: bal, productionDay: prod });
  }
  return out;
}

// ── ακρίβεια ────────────────────────────────────────────────────────────────

export interface AccuracyRow {
  day: string;
  warehouseId: string;
  forecast: number;
  baseline: number | null;
  actual: number;
}

export interface Accuracy {
  /** MAPE % της πρόβλεψης με καιρό (σύνολο ημέρας ανά κατάστημα) */
  mape: number | null;
  /** MAPE % της απλής μεθόδου (μ.ο. ημέρας εβδομάδας) στις ίδιες ημέρες */
  mapeBaseline: number | null;
  days: number;
}

/** MAPE στα σύνολα ημέρας × καταστήματος (οι μικρές ποσότητες ανά γεύση δεν «φουσκώνουν» το ποσοστό) */
export function forecastAccuracy(rows: readonly AccuracyRow[]): Accuracy {
  const agg = new Map<string, { f: number; b: number; bOk: boolean; a: number }>();
  for (const r of rows) {
    const k = `${r.warehouseId}|${r.day}`;
    const cur = agg.get(k) ?? { f: 0, b: 0, bOk: true, a: 0 };
    cur.f += Math.max(0, r.forecast);
    if (r.baseline === null || !Number.isFinite(r.baseline)) cur.bOk = false;
    else cur.b += Math.max(0, r.baseline);
    cur.a += Math.max(0, r.actual);
    agg.set(k, cur);
  }
  let sum = 0;
  let sumB = 0;
  let n = 0;
  let nB = 0;
  for (const v of agg.values()) {
    if (!(v.a > 0)) continue;
    sum += Math.abs(v.f - v.a) / v.a;
    n += 1;
    if (v.bOk) {
      sumB += Math.abs(v.b - v.a) / v.a;
      nB += 1;
    }
  }
  return {
    mape: n ? (sum / n) * 100 : null,
    mapeBaseline: nB ? (sumB / nB) * 100 : null,
    days: n,
  };
}

/**
 * Συνολικός πολλαπλασιαστής καιρού ανά ημέρα για το MRP: Σ πρόβλεψη με καιρό ÷ Σ χωρίς καιρό (ίδια
 * βάση και ημέρα εβδομάδας), περιορισμένος στα όρια του μοντέλου. Ημέρες χωρίς στοιχεία → καμία τιμή.
 */
export function mrpDayFactors(
  rows: ReadonlyArray<{ day: string; withWeather: number; withoutWeather: number }>,
): Record<string, number> {
  const acc = new Map<string, { w: number; o: number }>();
  for (const r of rows) {
    const cur = acc.get(r.day) ?? { w: 0, o: 0 };
    cur.w += Math.max(0, r.withWeather);
    cur.o += Math.max(0, r.withoutWeather);
    acc.set(r.day, cur);
  }
  const out: Record<string, number> = {};
  for (const [day, v] of acc) {
    if (!(v.o > 0)) continue;
    out[day] = clamp(v.w / v.o, WEATHER_MODEL.factorBounds[0], WEATHER_MODEL.factorBounds[1]);
  }
  return out;
}

/** «βάση 6,2 × Τρίτη 1,10 × θερμοκρασία 1,24 × βροχή 0,85 = 7,2» */
export function explainForecast(f: DayForecast, fmt: (v: number) => string, unit: string, weekdayLabel: string): string {
  const bits = [`βάση ${fmt(f.base)} ${unit}`, `${weekdayLabel} ×${fmt(f.weekdayFactor)}`];
  if (f.weather.missing) bits.push("καιρός: χωρίς στοιχεία ×1");
  else {
    bits.push(`θερμοκρασία ×${fmt(f.weather.temp)}`);
    if (f.weather.rain !== 1) bits.push(`βροχή ×${fmt(f.weather.rain)}`);
  }
  return `${bits.join(" × ")} = ${fmt(f.qty)} ${unit}`;
}
