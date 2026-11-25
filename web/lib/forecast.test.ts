import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateForecast } from "./forecast.ts";

test("forecast: 28ήμερο ιστορικό προβάλλεται σε 7 ημέρες με στρογγυλοποίηση", () => {
  const row = calculateForecast({ genericItemId: "a", historicalBase: 11, confirmedWholesaleBase: 4, availableBase: 2, plannedProductionBase: 1 });
  assert.equal(row.historicalForecastBase, 3);
  assert.equal(row.grossDemandBase, 7);
  assert.equal(row.suggestedBase, 4);
  assert.match(row.explanation, /11 → 7 ημέρες: 3/);
  assert.match(row.explanation, /Επιβεβαιωμένη χονδρική: 4/);
  assert.match(row.explanation, /Πρόταση = max\(0, 7 − 2 − 1\) = 4/);
});

test("forecast: available και planned δεν δημιουργούν αρνητική πρόταση", () => {
  const row = calculateForecast({ genericItemId: "a", historicalBase: 100, confirmedWholesaleBase: 10, availableBase: 100, plannedProductionBase: 50 });
  assert.equal(row.historicalForecastBase, 25);
  assert.equal(row.suggestedBase, 0);
  assert.match(row.explanation, /= 0\./);
});

test("forecast: μηδενικό ιστορικό με confirmed demand εξακολουθεί να προτείνει", () => {
  const row = calculateForecast({ genericItemId: "a", historicalBase: 0, confirmedWholesaleBase: 12, availableBase: 2, plannedProductionBase: 0 });
  assert.equal(row.suggestedBase, 10);
});

test("forecast: απορρίπτει αρνητικά ή κλασματικά base quantities", () => {
  assert.throws(() => calculateForecast({ genericItemId: "a", historicalBase: -1, confirmedWholesaleBase: 0, availableBase: 0, plannedProductionBase: 0 }), /μη αρνητικός ακέραιος/);
  assert.throws(() => calculateForecast({ genericItemId: "a", historicalBase: 1.5, confirmedWholesaleBase: 0, availableBase: 0, plannedProductionBase: 0 }), /μη αρνητικός ακέραιος/);
});
