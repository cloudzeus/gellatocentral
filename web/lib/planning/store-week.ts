// Η εβδομάδα του καταστήματος για την οθόνη «Σχεδιασμός»: συνολική ζήτηση (όλα τα είδη μαζί) με και
// χωρίς καιρό, και πόσο έπεσε μέσα η πρόβλεψη τις τελευταίες εβδομάδες (MAPE με backtest, χωρίς να
// χρειάζεται αποθηκευμένη πρόβλεψη· η αποθήκευση έρχεται με την 4β).
import { addDays } from "./production-suggest.ts";
import { fitSeries, forecastAccuracy, forecastDay, plainWeekdayDemand, type HistorySample, type WeatherDay } from "./weather-forecast.ts";

/** Ένα σύνολο ανά ημέρα· ημέρα με εξάντληση σε κάποιο είδος = λογοκριμένη για όλο το σύνολο. */
export function sumHistory(byItem: Iterable<readonly HistorySample[]>): HistorySample[] {
  const days = new Map<string, HistorySample>();
  for (const samples of byItem) for (const s of samples) {
    const cur = days.get(s.day) ?? { day: s.day, qty: 0, stockout: false };
    cur.qty += Math.max(0, s.qty);
    cur.stockout ||= s.stockout;
    days.set(s.day, cur);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type WeekDay = { day: string; withWeather: number; withoutWeather: number; weather: WeatherDay | null; factorPct: number };

/** Επόμενες `days` ημέρες από `today`: ζήτηση με καιρό και η ίδια χωρίς τον συντελεστή καιρού. */
export function storeWeek(history: readonly HistorySample[], weather: ReadonlyMap<string, WeatherDay>, today: string, days = 7): { days: WeekDay[]; lowData: boolean } {
  const model = fitSeries(history, weather, today);
  return {
    lowData: model.lowData,
    days: Array.from({ length: days }, (_, i) => addDays(today, i)).map((day) => {
      const f = forecastDay(model, day, weather.get(day));
      const total = f.weather.total || 1;
      return { day, withWeather: Math.round(f.qty), withoutWeather: Math.round(f.qty / total), weather: weather.get(day) ?? null, factorPct: Math.round((total - 1) * 100) };
    }),
  };
}

/**
 * Backtest: για κάθε μία από τις τελευταίες `days` ημέρες με πραγματική μέτρηση (χωρίς εξάντληση), πρόβλεψη
 * μόνο με ό,τι ήταν γνωστό ως τότε, απέναντι στο πραγματικό. Δίνει MAPE με καιρό και της απλής μεθόδου.
 */
export function backtestAccuracy(history: readonly HistorySample[], weather: ReadonlyMap<string, WeatherDay>, today: string, days = 28) {
  const from = addDays(today, -days);
  const rows = history.filter((s) => s.day >= from && s.day < today && !s.stockout && s.qty > 0).map((s) => {
    const model = fitSeries(history, weather, s.day);
    return { day: s.day, warehouseId: "", forecast: forecastDay(model, s.day, weather.get(s.day)).qty, baseline: plainWeekdayDemand(history, s.day, s.day), actual: s.qty };
  });
  return forecastAccuracy(rows);
}
