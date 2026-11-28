// Fixtures της παλιάς weather-forecast.test.ts (το μοντέλο δουλεύει με λόγους· οι μονάδες δεν το επηρεάζουν).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, DEFAULT_ELASTICITY, explainForecast, fitElasticity, fitSeries, forecastAccuracy, forecastDay, mergeDay, metNoUrl, metSymbolToWmo, mrpDayFactors, parseMetNoDaily, plainWeekdayDemand, planWeek, splitOutliers, WEATHER_MODEL, weatherFactor, type HistorySample, type WeatherDay } from "./weather-forecast.ts";

const TODAY = "2026-11-13";
const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≉ ${b}`);

/** qty = base × wk × (1+β)^h × (βροχή ? 1+γ : 1) */
function synth(days: number, opts: { base?: number; beta?: number; gamma?: number; temp?: (i: number) => number; rainEvery?: number; wk?: number[] }) {
  const { base = 10, beta = 0.05, gamma = -0.2, wk = [1, 1, 1, 1, 1, 1, 1] } = opts;
  const weather = new Map<string, WeatherDay>();
  const hist: HistorySample[] = [];
  for (let i = days; i >= 1; i--) {
    const day = addDays(TODAY, -i);
    const t = opts.temp ? opts.temp(i) : 15 + 15 * Math.sin((i / 365) * 2 * Math.PI) ** 2;
    const rain = opts.rainEvery ? i % opts.rainEvery === 0 : false;
    weather.set(day, { day, tmax: t, precip: rain ? 5 : 0 });
    const h = Math.min(18, Math.max(0, t - 20));
    hist.push({ day, qty: base * wk[new Date(`${day}T00:00:00Z`).getUTCDay()]! * Math.pow(1 + beta, h) * (rain ? 1 + gamma : 1), stockout: false });
  }
  return { weather, hist };
}

test("συντελεστής καιρού: 1 ως 20 °C χωρίς βροχή, μεγαλώνει με τη ζέστη, πέφτει με βροχή, έχει όρια, 1 χωρίς στοιχεία", () => {
  assert.equal(weatherFactor({ day: TODAY, tmax: 18, precip: 0 }, DEFAULT_ELASTICITY).total, 1);
  assert.equal(weatherFactor({ day: TODAY, tmax: 20, precip: 0.5 }, DEFAULT_ELASTICITY).total, 1);
  const hot = weatherFactor({ day: TODAY, tmax: 30, precip: 0 }, DEFAULT_ELASTICITY);
  close(hot.temp, Math.pow(1.035, 10));
  close(weatherFactor({ day: TODAY, tmax: 30, precip: 8 }, DEFAULT_ELASTICITY).total, hot.total * 0.85);
  assert.ok(weatherFactor({ day: TODAY, tmax: 60, precip: 0 }, { ...DEFAULT_ELASTICITY, tempPct: 8 }).total <= WEATHER_MODEL.factorBounds[1]);
  assert.equal(weatherFactor(null, DEFAULT_ELASTICITY).missing, true);
  assert.equal(weatherFactor({ day: TODAY, tmax: null, precip: null }, DEFAULT_ELASTICITY).missing, true);
});

test("ελαστικότητα: βρίσκει β, γ με πολλά δεδομένα· λίγα → συρρίκνωση· χωρίς ζέστη/βροχή → προεπιλογές· όρια", () => {
  const { weather, hist } = synth(365, { beta: 0.05, gamma: -0.2, rainEvery: 6 });
  const e = fitElasticity(hist, weather);
  close(e.rawTempPct!, 5, 1);
  close(e.rawRainPct!, -20, 1);
  assert.ok(e.tempPct > 4.5 && e.tempPct < 5 && e.rainPct < -18);
  const short = synth(20, { beta: 0.07, temp: (i) => 21 + (i % 8) });
  const s = fitElasticity(short.hist, short.weather);
  assert.equal(s.warmDays, 20);
  assert.ok(s.tempWeight < 0.4 && s.tempPct > DEFAULT_ELASTICITY.tempPct && s.tempPct < s.rawTempPct!);
  const cold = synth(90, { temp: () => 14 });
  const c = fitElasticity(cold.hist, cold.weather);
  assert.deepEqual([c.rawTempPct, c.tempPct, c.rainPct], [null, DEFAULT_ELASTICITY.tempPct, DEFAULT_ELASTICITY.rainPct]);
  const up = synth(365, { beta: 0.3 });
  assert.ok(fitElasticity(up.hist, up.weather).tempPct <= WEATHER_MODEL.tempPctBounds[1]);
  const down = synth(365, { beta: -0.05 });
  assert.ok(fitElasticity(down.hist, down.weather).tempPct >= 0);
  const noisy = synth(200, { beta: 0.05 });
  const w2 = new Map(noisy.weather);
  for (const x of noisy.hist.slice(0, 30)) w2.delete(x.day);
  close(fitElasticity(noisy.hist.map((x, i) => (i % 5 === 0 ? { ...x, qty: 0.1, stockout: true } : x)), w2).rawTempPct!, 5, 1);
});

test("μοντέλο σειράς: βάση × ημέρα × καιρός, λίγα δεδομένα, χωρίς ιστορικό, απλή μέθοδος σύγκρισης", () => {
  const { weather, hist } = synth(365, { base: 10, beta: 0.04, wk: [1.5, 0.8, 0.8, 0.9, 1, 1.2, 1.4], rainEvery: 9 });
  const m = fitSeries(hist, weather, TODAY);
  assert.equal(m.lowData, false);
  assert.ok(m.base > 9 && m.base < 11.5);
  const f = forecastDay(m, "2026-11-14", { day: "2026-11-14", tmax: 30, precip: 0 });
  assert.ok(f.weekdayFactor > 1.1);
  close(f.qty, f.base * f.weekdayFactor * f.weather.total, 9);
  assert.match(explainForecast(f, (v) => v.toFixed(2), "kg", "Σάββατο"), /θερμοκρασία.*= /);
  assert.equal(fitSeries(synth(40, {}).hist, synth(40, {}).weather, TODAY).lowData, true);
  assert.equal(fitSeries(synth(80, {}).hist, synth(80, {}).weather, TODAY).lowData, true);
  assert.equal(fitSeries(synth(120, {}).hist, synth(120, {}).weather, TODAY).lowData, false);
  const empty = fitSeries([], new Map(), TODAY);
  assert.equal(empty.base, 0);
  assert.equal(forecastDay(empty, TODAY, null).qty, 0);
  close(plainWeekdayDemand(synth(60, { base: 10, temp: () => 15 }).hist, TODAY, "2026-11-14"), 10);
});

test("λάθη απογραφής εξαιρούνται και δεν «φουσκώνουν» τη βάση", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
  const qtys = [2, 1.5, 2.2, 1.8, 8829.2, 2.1, -3];
  const r = splitOutliers(days.map((day, i) => ({ day, qty: qtys[i]!, stockout: false })));
  assert.deepEqual(r.outliers.map((o) => o.qty).sort((a, b) => a - b), [-3, 8829.2]);
  assert.equal(r.kept.length, 5);
  const hist = Array.from({ length: 40 }, (_, i) => ({ day: `2026-10-${String((i % 30) + 1).padStart(2, "0")}`, qty: 2, stockout: false }));
  hist[5] = { day: "2026-10-24", qty: 8829.2, stockout: false };
  const m = fitSeries(hist, new Map(), TODAY);
  assert.ok(m.base < 5 && m.outliers.some((o) => o.qty === 8829.2));
});

test("ακρίβεια (MAPE) στα σύνολα ημέρας ανά αποθήκη και συντελεστές καιρού για το MRP", () => {
  const a = forecastAccuracy([
    { day: "2026-11-01", warehouseId: "w", forecast: 9, baseline: 8, actual: 5 },
    { day: "2026-11-01", warehouseId: "w", forecast: 2, baseline: 2, actual: 5 },
    { day: "2026-11-02", warehouseId: "w", forecast: 12, baseline: 15, actual: 10 },
    { day: "2026-11-03", warehouseId: "w", forecast: 3, baseline: null, actual: 0 },
  ]);
  assert.equal(a.days, 2);
  close(a.mape!, (1 / 10 + 2 / 10) / 2 * 100);
  close(a.mapeBaseline!, (0 / 10 + 5 / 10) / 2 * 100);
  assert.equal(forecastAccuracy([]).mape, null);
  const f = mrpDayFactors([{ day: "d1", withWeather: 12, withoutWeather: 10 }, { day: "d1", withWeather: 6, withoutWeather: 5 }, { day: "d2", withWeather: 100, withoutWeather: 1 }, { day: "d3", withWeather: 1, withoutWeather: 0 }]);
  close(f.d1!, 1.2, 9);
  assert.equal(f.d2, WEATHER_MODEL.factorBounds[1]);
  assert.equal(f.d3, undefined);
});

test("MET Norway: ωριαία → τοπική ημέρα (μέγιστη/ελάχιστη, υετός, χειρότερο σύμβολο), μερική σημερινή, συντεταγμένες 4 δεκαδικών", () => {
  const entry = (time: string, t: number, p1: number | null, sym: string, p6: number | null = null) => ({ time, data: { instant: { details: { air_temperature: t } }, ...(p1 !== null ? { next_1_hours: { summary: { symbol_code: sym }, details: { precipitation_amount: p1 } } } : {}), ...(p6 !== null ? { next_6_hours: { summary: { symbol_code: sym }, details: { precipitation_amount: p6 } } } : {}) } });
  const ts = [
    ...Array.from({ length: 17 }, (_, i) => entry(`2026-11-14T${String(4 + i).padStart(2, "0")}:00:00Z`, 14 + Math.min(i, 16 - i), i === 8 ? 1.5 : 0, i === 8 ? "rainshowers_day" : "fair_day")),
    entry("2026-11-15T04:00:00Z", 12, null, "cloudy", 0.4), entry("2026-11-15T10:00:00Z", 19, null, "lightrain", 2), entry("2026-11-15T16:00:00Z", 16, null, "cloudy", 0), entry("2026-11-15T21:00:00Z", 13, null, "cloudy", 0),
  ];
  const d = parseMetNoDaily({ properties: { timeseries: ts } });
  assert.deepEqual(d.map((x) => x.day), ["2026-11-14", "2026-11-15"]);
  assert.deepEqual([d[0]!.tmax, d[0]!.tmin, d[0]!.precip, d[0]!.code, d[0]!.partial], [22, 14, 1.5, 80, false]);
  assert.deepEqual([d[1]!.tmax, d[1]!.precip, d[1]!.code], [19, 2.4, 61]);
  const partial = parseMetNoDaily({ properties: { timeseries: [entry("2026-11-14T13:00:00Z", 20, 0, "fair_day"), entry("2026-11-14T14:00:00Z", 21, 0, "fair_day"), entry("2026-11-14T15:00:00Z", 19, 0, "fair_day"), entry("2026-11-14T16:00:00Z", 18, 0, "fair_day"), entry("2026-11-15T10:00:00Z", 30, 0, "fair_day"), { time: 5 }] } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0]!.partial, true);
  assert.deepEqual(parseMetNoDaily(null), []);
  assert.equal(mergeDay({ day: "d", tmax: 24, precip: 0 }, { day: "d", tmax: 19, precip: 1 }, true).tmax, 24);
  assert.equal(mergeDay({ day: "d", tmax: 24, precip: 0 }, { day: "d", tmax: 19, precip: 0 }, false).tmax, 19);
  assert.equal(metSymbolToWmo("heavyrain"), 65);
  assert.equal(metNoUrl(37.98381234, 23.72751234), "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=37.9838&lon=23.7275");
});

test("πλάνο εβδομάδας: καλύπτει ως την επόμενη ημέρα παραγωγής, καραπίνες, φύρα στο μίγμα", () => {
  const days = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]; // Παρ–Δευ
  const plan = planWeek({ days, demand: [5_000_000, 8_000_000, 7_000_000, 4_000_000], stock: 2_000_000, planned: [0, 0, 0, 0], productionWeekdays: [1, 2, 3, 4, 5], dimension: "mass", containerCap: 4_500_000, lossPct: 4 });
  assert.equal(plan[0]!.containers, 4); // 20 − 2 = 18 kg → 4 καραπίνες
  assert.equal(plan[0]!.output, 18_000_000);
  assert.equal(plan[0]!.mix, 18_750_000);
  assert.equal(plan[1]!.productionDay, false);
  assert.equal(plan[2]!.end, 0);
});
