// Καθαρή 7ήμερη πρόβλεψη σε ακέραιες βασικές μονάδες· κάθε πρόταση κρατά το πλήρες reasoning.
export type ForecastInput = {
  genericItemId: string;
  historicalBase: number;
  confirmedWholesaleBase: number;
  availableBase: number;
  plannedProductionBase: number;
};

export type ForecastResult = ForecastInput & {
  historicalForecastBase: number;
  grossDemandBase: number;
  suggestedBase: number;
  explanation: string;
};

const nonNegative = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}: μη αρνητικός ακέραιος`);
  return value;
};

export function calculateForecast(input: ForecastInput, historyDays = 28, forecastDays = 7): ForecastResult {
  if (!Number.isSafeInteger(historyDays) || historyDays < 1 || !Number.isSafeInteger(forecastDays) || forecastDays < 1) throw new Error("Άκυρη περίοδος πρόβλεψης");
  const historicalBase = nonNegative(input.historicalBase, "Ιστορική ζήτηση");
  const confirmedWholesaleBase = nonNegative(input.confirmedWholesaleBase, "Επιβεβαιωμένη χονδρική");
  const availableBase = nonNegative(input.availableBase, "Διαθέσιμο απόθεμα");
  const plannedProductionBase = nonNegative(input.plannedProductionBase, "Προγραμματισμένη παραγωγή");
  const historicalForecastBase = Math.round(historicalBase * forecastDays / historyDays);
  if (!Number.isSafeInteger(historicalForecastBase)) throw new Error("Η ιστορική πρόβλεψη υπερβαίνει το ασφαλές όριο");
  const grossDemandBase = historicalForecastBase + confirmedWholesaleBase;
  const suggestedBase = Math.max(0, grossDemandBase - availableBase - plannedProductionBase);
  return {
    ...input, historicalForecastBase, grossDemandBase, suggestedBase,
    explanation: `Ιστορικό ${historyDays} ημερών: ${historicalBase} → ${forecastDays} ημέρες: ${historicalForecastBase}. Επιβεβαιωμένη χονδρική: ${confirmedWholesaleBase}. Διαθέσιμο: ${availableBase}. Προγραμματισμένη παραγωγή: ${plannedProductionBase}. Πρόταση = max(0, ${grossDemandBase} − ${availableBase} − ${plannedProductionBase}) = ${suggestedBase}.`,
  };
}
