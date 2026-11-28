// MRP v2 (μεταφορά των βοηθητικών του mrp.ts της παλιάς) πάνω στο υπάρχον `mrpSuggestion`:
// απόθεμα ασφαλείας που μαθαίνεται (z·σ·√(L+R)), χρόνος παράδοσης από το ιστορικό, σποραδικά υλικά
// με διάμεσο, συντελεστής ημέρας εβδομάδας και απώλειες απογραφής. Ακέραιες βασικές μονάδες στην έξοδο.
import { mrpSuggestion } from "../procurement.ts";
import { addDays } from "./production-suggest.ts";

const DAY_MS = 86_400_000;
export const SERVICE_Z = 1.65;
export const MIN_USAGE_DAYS_FOR_LEARNING = 4;
export const MANUAL_MIN_CAP_EXTRA_DAYS = 7;
export const PERISHABLE_MAX_SAFETY_DAYS = 2;
export const LEAD_HISTORY_DAYS = 180;
export const MIN_LEAD_ORDERS = 3;
export const DEFAULT_LEAD_DAYS = 2;
export const WEEKDAY_PROFILE_WEEKS = 8;
export const WEEKDAY_MIN_WEEKS = 4;
export const WEEKDAY_MAX_FACTOR = 3;
export const LOSS_WINDOW_DAYS = 90;

/** 1 = Δευτέρα … 7 = Κυριακή (όπως το nextAllowedDay). */
export const isoWeekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
export type ByDay = Readonly<Record<string, number | undefined>>;

// ── χρόνος παράδοσης ─────────────────────────────────────────────────────────

/** Μία παραλαβή: ημέρα παραγγελίας και ημέρα (Αθήνας) παραλαβής. */
export type ReceiptSample = { supplierId: string; orderId: string | null; orderDay: string; receivedDay: string };
export type LeadSource = "history" | "manual" | "default";

/** Ένα δείγμα ανά παραγγελία (η πρώτη παραλαβή της), στις τελευταίες `windowDays` ημέρες. */
export function leadSamples(history: readonly ReceiptSample[], opts: { today?: string; windowDays?: number } = {}) {
  const since = opts.today ? addDays(opts.today, -(opts.windowDays ?? LEAD_HISTORY_DAYS)) : null;
  const first = new Map<string, ReceiptSample>();
  history.forEach((h, i) => {
    if (since && h.receivedDay < since) return;
    const key = h.orderId ? `o:${h.orderId}` : `n:${i}`;
    const prev = first.get(key);
    if (!prev || h.receivedDay < prev.receivedDay) first.set(key, h);
  });
  return [...first.values()].map((f) => ({ supplierId: f.supplierId, days: daysBetween(f.orderDay, f.receivedDay) })).filter((s) => s.days >= 0 && s.days <= 60);
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Διάμεσος ημερών παραγγελία → παραλαβή ανά προμηθευτή, τουλάχιστον 1. */
export function supplierLeadDays(history: readonly ReceiptSample[], opts: { today?: string; windowDays?: number } = {}): Record<string, number> {
  const by = new Map<string, number[]>();
  for (const s of leadSamples(history, opts)) by.set(s.supplierId, [...(by.get(s.supplierId) ?? []), s.days]);
  return Object.fromEntries([...by].map(([id, list]) => [id, Math.max(1, Math.ceil(median(list)))]));
}

/** Ιστορικό με ≥ 3 παραγγελίες υπερισχύει· αλλιώς χειροκίνητος χρόνος· αλλιώς το λίγο ιστορικό· αλλιώς τίποτα (2 ημέρες). */
export function resolveLeadDays(history: readonly ReceiptSample[], manual: Readonly<Record<string, number | null | undefined>>, opts: { today?: string; windowDays?: number } = {}) {
  const samples: Record<string, number> = {};
  for (const s of leadSamples(history, opts)) samples[s.supplierId] = (samples[s.supplierId] ?? 0) + 1;
  const hist = supplierLeadDays(history, opts);
  const days: Record<string, number> = {}, source: Record<string, LeadSource> = {};
  for (const [id, d] of Object.entries(hist)) if ((samples[id] ?? 0) >= MIN_LEAD_ORDERS) { days[id] = d; source[id] = "history"; }
  for (const [id, raw] of Object.entries(manual)) {
    if (days[id] !== undefined) continue;
    const v = Math.floor(raw ?? 0);
    if (v >= 1) { days[id] = v; source[id] = "manual"; }
  }
  for (const [id, d] of Object.entries(hist)) if (days[id] === undefined) { days[id] = d; source[id] = "history"; }
  return { days, source, samples };
}

/** R: ημέρες ως την επόμενη ημέρα παραγγελίας (μετά από σήμερα)· χωρίς ημέρες = 0. */
export function reviewPeriodDays(today: string, orderDays: readonly number[] | undefined): number {
  const allowed = (orderDays ?? []).filter((d) => d >= 1 && d <= 7);
  for (let k = 1; k <= 7 && allowed.length; k++) if (allowed.includes(isoWeekday(addDays(today, k)))) return k;
  return 0;
}

// ── κατανάλωση ──────────────────────────────────────────────────────────────

export interface UsageStats { avgDaily: number; sdDaily: number; maxDaily: number; usageDays: number }

/** Στατιστικά των `windowDays` ημερών ως και `end` (οι ημέρες χωρίς κατανάλωση μετρούν 0). */
export function usageStats(byDay: ByDay | undefined, end: string, windowDays: number): UsageStats {
  const n = Math.max(1, Math.floor(windowDays));
  const values = Array.from({ length: n }, (_, i) => Math.max(0, byDay?.[addDays(end, -i)] ?? 0));
  const avgDaily = values.reduce((a, b) => a + b, 0) / n;
  const sdDaily = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - avgDaily) ** 2, 0) / (n - 1)) : 0;
  return { avgDaily, sdDaily, maxDaily: Math.max(0, ...values), usageDays: values.filter((v) => v > 0).length };
}

/**
 * max(z·σ·√(L+R), μεγαλύτερη ημέρα), έως 2 ημέρες μέσης χρήσης για ευαλλοίωτα. Με λίγο ιστορικό ισχύει
 * το χειροκίνητο ελάχιστο, περιορισμένο σε μία παρτίδα / κύκλο παραγγελίας όταν η χρήση είναι σποραδική.
 */
export function learnedSafety(stats: UsageStats, leadDays: number, manualMin: number, perishable = false, reviewDays = 0, minUsageDays = MIN_USAGE_DAYS_FOR_LEARNING): { value: number; source: "auto" | "manual"; capped?: boolean } {
  if (stats.usageDays < minUsageDays && manualMin > 0) {
    if (stats.usageDays > 0) {
      const cap = Math.max(stats.maxDaily, stats.avgDaily * (Math.max(1, leadDays) + MANUAL_MIN_CAP_EXTRA_DAYS));
      if (cap > 0 && cap < manualMin) return { value: cap, source: "manual", capped: true };
    }
    return { value: manualMin, source: "manual" };
  }
  let value = Math.max(SERVICE_Z * stats.sdDaily * Math.sqrt(Math.max(1, leadDays) + Math.max(0, reviewDays)), stats.maxDaily);
  if (perishable && stats.avgDaily > 0) value = Math.min(value, PERISHABLE_MAX_SAFETY_DAYS * stats.avgDaily);
  return { value, source: "auto" };
}

/** Σποραδικό υλικό: διάμεσος των ημερών με χρήση (≥ 3), αλλιώς η πιο πρόσφατη χρήση. */
export function sporadicUsage(byDay: ByDay | undefined, end: string, windowDays: number) {
  const used: { date: string; q: number }[] = [];
  for (let i = 0; i < Math.max(1, Math.floor(windowDays)); i++) {
    const date = addDays(end, -i), q = Math.max(0, byDay?.[date] ?? 0);
    if (q > 0) used.push({ date, q });
  }
  const last = used[0] ?? null;
  const typical = used.length >= 3 ? median(used.map((u) => u.q)) : last?.q ?? 0;
  return { typical, lastUsage: last?.q ?? 0, lastUsageDate: last?.date ?? null, usageDays: used.length };
}

/**
 * Συντελεστής Δευ…Κυρ (δείκτης 0 = Δευτέρα) από 8 εβδομάδες ως την `end`, κανονικοποιημένος σε μέσο 1,
 * ≤ 3· null με λιγότερες από 4 εβδομάδες με κατανάλωση. Οι ημέρες πριν από την πρώτη χρήση δεν μετρούν.
 */
export function weekdayProfile(byDay: ByDay | undefined, end: string, weeks = WEEKDAY_PROFILE_WEEKS): number[] | null {
  if (!byDay) return null;
  const sums = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0];
  let weeksWithUsage = 0, oldest = -1;
  for (let i = 0; i < weeks * 7; i++) if ((byDay[addDays(end, -i)] ?? 0) > 0) oldest = i;
  for (let w = 0; w < weeks; w++) {
    const days: [number, number][] = [];
    let weekSum = 0;
    for (let i = 0; i < 7 && w * 7 + i <= oldest; i++) {
      const date = addDays(end, -(w * 7 + i)), v = Math.max(0, byDay[date] ?? 0);
      days.push([isoWeekday(date) - 1, v]);
      weekSum += v;
    }
    if (!(weekSum > 0)) continue;
    weeksWithUsage += 1;
    for (const [wd, v] of days) { sums[wd]! += v; counts[wd]! += 1; }
  }
  if (weeksWithUsage < WEEKDAY_MIN_WEEKS) return null;
  const means = sums.map((v, i) => (counts[i] ? v / counts[i]! : 0));
  const mean = means.reduce((a, b) => a + b, 0) / 7;
  if (!(mean > 0)) return null;
  const raw = means.map((m) => Math.min(WEEKDAY_MAX_FACTOR, m / mean));
  const rawMean = raw.reduce((a, b) => a + b, 0) / 7;
  return raw.map((f) => f / rawMean);
}

/** Απώλειες απογραφής ανά ημέρα: Σ των απωλειών 90 ημερών ÷ 90. */
export function countLossDaily(byDay: ByDay | undefined, end: string, windowDays = LOSS_WINDOW_DAYS): number {
  if (!byDay) return 0;
  let sum = 0;
  for (let i = 0; i < windowDays; i++) sum += Math.max(0, byDay[addDays(end, -i)] ?? 0);
  return sum / windowDays;
}

// ── πρόταση ─────────────────────────────────────────────────────────────────

export type MrpV2Input = {
  today: string;
  onHandBaseQty: number;
  /** κατανάλωση ανά ημέρα (DemandDaily: consumed + waste, χωρίς χονδρική) */
  usageByDay: ByDay;
  /** απώλειες απογραφής ανά ημέρα */
  lossByDay?: ByDay;
  /** βέβαιη ζήτηση (παρτίδες + επιβεβαιωμένη χονδρική) ανά ημέρα, από το mrp-demand */
  firmByDay?: ByDay;
  mode?: "auto" | "regular" | "sporadic";
  leadDays?: number | null;
  coverDays: number;
  orderDays?: readonly number[];
  usageWindowDays?: number;
  sporadicUsageDays?: number;
  manualMinBaseQty?: number;
  perishable?: boolean;
  minimumBaseQty?: number;
  orderMultipleBase?: number;
};

/**
 * Ζήτηση/ημέρα = max(βέβαιη ζήτηση, μέση χρήση × συντελεστής ημέρας) + απώλειες, για L + R + κάλυψη
 * ημέρες· ασφάλεια που μαθαίνεται. Η στρογγυλοποίηση σε συσκευασίες γίνεται από το `mrpSuggestion`.
 */
export function mrpV2Suggestion(input: MrpV2Input) {
  const window = input.usageWindowDays ?? 28;
  const end = addDays(input.today, -1);
  const stats = usageStats(input.usageByDay, end, window);
  const sporadicDays = input.sporadicUsageDays ?? MIN_USAGE_DAYS_FOR_LEARNING;
  const mode = input.mode === "regular" || input.mode === "sporadic" ? input.mode : stats.usageDays < sporadicDays ? "sporadic" : "regular";
  const leadDays = input.leadDays && input.leadDays >= 1 ? Math.floor(input.leadDays) : DEFAULT_LEAD_DAYS;
  const reviewDays = reviewPeriodDays(input.today, input.orderDays);
  const horizon = leadDays + reviewDays + Math.max(0, input.coverDays);
  const profile = mode === "regular" ? weekdayProfile(input.usageByDay, end) : null;
  const loss = countLossDaily(input.lossByDay, end);
  const sporadic = mode === "sporadic" ? sporadicUsage(input.usageByDay, end, window) : null;
  let forecast = 0, firm = 0;
  for (let k = 0; k < horizon; k++) {
    const day = addDays(input.today, k);
    const dayFirm = Math.max(0, input.firmByDay?.[day] ?? 0);
    const usual = mode === "regular" ? stats.avgDaily * (profile ? profile[isoWeekday(day) - 1]! : 1) : 0;
    firm += dayFirm;
    forecast += Math.max(dayFirm, usual) + loss;
  }
  // Σποραδικό: μία τυπική χρήση στον ορίζοντα, όχι μέσος όρος σπασμένος σε ημέρες.
  if (sporadic) forecast = Math.max(firm, sporadic.typical) + loss * horizon;
  const safety = mode === "sporadic" ? { value: input.manualMinBaseQty ?? 0, source: "manual" as const } : learnedSafety(stats, leadDays, input.manualMinBaseQty ?? 0, input.perishable, reviewDays);
  const result = mrpSuggestion({
    onHandBaseQty: Math.max(0, input.onHandBaseQty),
    averageDailyUsageBaseQty: horizon ? forecast / horizon : 0,
    leadDays: leadDays + reviewDays,
    coverDays: Math.max(0, input.coverDays),
    safetyBaseQty: Math.ceil(safety.value),
    minimumBaseQty: input.minimumBaseQty,
    orderMultipleBase: input.orderMultipleBase,
  });
  return { ...result, mode, leadDays, reviewDays, horizonDays: horizon, forecastBaseQty: Math.ceil(forecast), firmBaseQty: Math.ceil(firm), safetyBaseQty: Math.ceil(safety.value), safetySource: safety.source, weekdayProfile: profile, avgDailyBaseQty: Math.round(stats.avgDaily) };
}
