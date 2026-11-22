// Tests για την τεχνική ανάλυση συνταγής (lib/recipe-analysis.ts).
// Οι αναμενόμενες τιμές είναι υπολογισμένες με το χέρι από τους τύπους (PAC/POD/στερεά).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  num,
  materialSugars,
  materialTotalSolids,
  materialLactose,
  alcoholByWeight,
  glucosePac,
  glucosePod,
  analyzeRecipe,
  stabilizerDoseCheck,
  balanceBar,
  evaluateTarget,
  targetFor,
  piecesFromGrams,
  costPerGramHundredths,
  LACTOSE_IN_MSNF,
  type RecipeLine,
} from "./recipe-analysis.ts";

const close = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps;

// Γάλα 3,5% και ζάχαρη — οι τιμές σύστασης όπως στον κεντρικό κατάλογο
const MILK = { fatPct: 3.5, msnfPct: 8.5, proteinAvailablePct: 3.3, costHundredthsPerGram: 0.0125 };
const SUGAR = { sucrosePct: 100, costHundredthsPerGram: 0.002 };
const baseLines: RecipeLine[] = [
  { grams: 1000, material: MILK },
  { grams: 500, material: SUGAR },
];

test("num: κόμμα ως υποδιαστολή, άκυρο → 0", () => {
  assert.equal(num("1,5"), 1.5);
  assert.equal(num("abc"), 0);
  assert.equal(num(null), 0);
});

test("σάκχαρα και ολικά στερεά είδους", () => {
  assert.equal(materialSugars({ sucrosePct: 10, dextrosePct: 5, glucoseSyrupPct: 2 }), 17);
  // totalSolids = λίπος + MSNF + σάκχαρα + λοιπά — η αιθανόλη δεν μετράει
  assert.equal(materialTotalSolids({ fatPct: 3.5, msnfPct: 8.5, sucrosePct: 1, alcoholPct: 40 }), 13);
  // το χειροκίνητο override υπερισχύει
  assert.equal(materialTotalSolids({ fatPct: 3.5, totalSolidsOverride: 12.2 }), 12.2);
});

test("λακτόζη: ρητή τιμή ή εκτίμηση από MSNF μόνο με πρωτεΐνες γάλακτος", () => {
  assert.equal(materialLactose({ lactosePct: 4.8 }), 4.8);
  assert.ok(close(materialLactose({ msnfPct: 8.5, proteinAvailablePct: 3.3 }), 8.5 * LACTOSE_IN_MSNF));
  assert.equal(materialLactose({ msnfPct: 8.5 }), 0); // χωρίς πρωτεΐνη δεν εκτιμάται
});

test("αλκοόλ: % vol → % κατά βάρος", () => {
  assert.ok(close(alcoholByWeight(40), (40 * 0.7893) / 0.948, 0.01));
  assert.equal(alcoholByWeight(0), 0);
});

test("σιρόπι γλυκόζης: συντελεστές από το DE", () => {
  assert.ok(close(glucosePac(38), 55.1));
  assert.ok(close(glucosePod(38), 24.7));
});

test("βάση γάλακτος: σύσταση, PAC/POD, στόχοι, κόστος", () => {
  const a = analyzeRecipe(baseLines, "cream");
  assert.equal(a.totalWeight, 1500);
  assert.ok(close(a.fat, 35 / 15));
  assert.ok(close(a.msnf, 85 / 15));
  assert.ok(close(a.sugars, 500 / 15));
  assert.ok(close(a.lactose, 46.325 / 15));
  assert.ok(close(a.totalSolids, 620 / 15));
  assert.ok(close(a.water, 880 / 15));
  // PAC: γάλα 4,6325 × 10 + ζάχαρη 100 × 5 = 546,325 g ισοδύναμης σακχαρόζης
  assert.ok(close(a.pac, 546.325 / 15));
  // POD: γάλα 4,6325×0,16 × 10 + ζάχαρη 100 × 5 = 507,412
  assert.ok(close(a.pod, 507.412 / 15));
  // AFP: στερεά 41,3% → κανόνας 40–43% → 2,4
  assert.equal(a.afpFactor, 2.4);
  assert.equal(a.afpReason, "Στ. στερεά 40–43%");
  // θερμοκρασία σερβιρίσματος = −PAC / AFP
  assert.ok(close(a.servingTemp, -(546.325 / 15) / 2.4));
  // σημείο πήξης τυπικής βάσης: γύρω στους −4 °C
  assert.ok(a.freezingPoint < -3 && a.freezingPoint > -5, `freezingPoint=${a.freezingPoint}`);
  // παγωμένο νερό: περισσότερο στους −18 από ό,τι στους −12
  assert.ok(a.frozenAtMinus18 > a.frozenAtMinus12);
  assert.ok(a.frozenAtMinus12 > 0 && a.frozenAtMinus12 <= 95);
  // λακτόζη/νερό
  assert.ok(close(a.lactoseWaterRatio, (46.325 / 880) * 100));
  // κόστος: 1000 g × 0,0125 + 500 g × 0,002 = 13,5 εκατοστά λεπτού
  assert.equal(a.costBatchHundredths, 14); // Math.round(13,5)
  assert.equal(a.costPerKgHundredths, 9);
});

test("sorbet: AFP 2,5 και κατηγορία φρούτου στον έλεγχο σταθεροποιητή", () => {
  const a = analyzeRecipe(
    [
      { grams: 600, material: { sucrosePct: 12, fiberPct: 1, otherSolidsPct: 1 } },
      { grams: 400, material: { sucrosePct: 100 } },
    ],
    "sorbet",
  );
  assert.equal(a.afpFactor, 2.5);
  assert.equal(a.afpReason, "Sorbet");
});

test("κακάο: AFP πάντα 2,3 με απόλυτη προτεραιότητα", () => {
  const a = analyzeRecipe([{ grams: 1000, material: { sucrosePct: 20, containsCocoa: true } }], "chocolate");
  assert.equal(a.afpFactor, 2.3);
  assert.equal(a.afpReason, "Σοκολάτα / κακάο");
});

test("πολύ όξινα φρούτα ≥7%: AFP 2,1", () => {
  const a = analyzeRecipe(
    [
      { grams: 100, material: { acidityLevel: "very_high", sucrosePct: 10 } },
      { grams: 900, material: { sucrosePct: 20 } },
    ],
    "sorbet",
  );
  // η οξύτητα προηγείται του sorbet στη σειρά των κανόνων
  assert.equal(a.afpFactor, 2.1);
});

test("κενή συνταγή: μηδενικά παντού, χωρίς σφάλμα", () => {
  const a = analyzeRecipe([], "cream");
  assert.equal(a.totalWeight, 0);
  assert.equal(a.pac, 0);
  assert.equal(a.costBatchHundredths, 0);
});

test("δόση σταθεροποιητή: κανόνας ολικών στερεών (milk, neutro5)", () => {
  const at = (pct: number, solids = 34) =>
    stabilizerDoseCheck(
      { totalSolids: solids, totalWeight: 5000, stabilizerDoseType: "neutro5", stabilizerDosePct: pct, stabilizerDoseGrams: (pct / 100) * 5000 },
      "cream",
    );
  assert.equal(at(0.5)?.status, "ok");
  assert.equal(at(0.5)?.deltaGrams, 0);
  assert.equal(at(0.4)?.status, "low");
  assert.equal(at(0.6)?.status, "high");
  // στα 36% στερεά η συνιστώμενη πέφτει κατά 0,02 → 0,48
  assert.ok(close(at(0.48, 36)!.recommendedPct, 0.48));
});

test("δόση σταθεροποιητή: base50 και mixed/none", () => {
  const base = stabilizerDoseCheck(
    { totalSolids: 34, totalWeight: 5000, stabilizerDoseType: "base50", stabilizerDosePct: 4.0, stabilizerDoseGrams: 200 },
    "cream",
  );
  assert.equal(base?.recommendedPct, 3.8);
  assert.equal(base?.status, "high");
  assert.equal(
    stabilizerDoseCheck({ totalSolids: 34, totalWeight: 5000, stabilizerDoseType: "mixed", stabilizerDosePct: 1, stabilizerDoseGrams: 50 }, "cream"),
    null,
  );
});

test("σταθεροποιητής: η δόση βγαίνει από το βάρος του ίδιου του είδους", () => {
  const a = analyzeRecipe(
    [
      { grams: 1000, material: MILK },
      { grams: 25, material: { stabilizerPct: 100 } }, // Neutro 5
    ],
    "cream",
  );
  assert.equal(a.stabilizerDoseType, "neutro5");
  assert.equal(a.stabilizerDoseGrams, 25);
  assert.ok(close(a.stabilizerDosePct, (25 / 1025) * 100));
});

test("τεμάχια από γραμμάρια", () => {
  assert.equal(piecesFromGrams({ gramsPerPiece: 55 }, 110), 2);
  assert.equal(piecesFromGrams({}, 110), 0);
});

test("κόστος ανά γραμμάριο από μέσο κόστος βασικής μονάδας", () => {
  // 12.500 εκατοστά/kg = 12,5 εκατοστά/g, με βασική μονάδα mg.
  assert.equal(costPerGramHundredths({ avgCostHundredths: 12_500, baseUnit: { dimension: "mass", toBase: 1_000_000 } }), 12.5);
  // αυγό 12 λεπτά (=1200 εκατοστά) το τεμάχιο των 55 g
  assert.ok(Math.abs(costPerGramHundredths({ avgCostHundredths: 1_200_000, baseUnit: { dimension: "count", toBase: 1 }, gramsPerPiece: 55 }) - 1200 / 55) < 1e-9);
  // χωρίς βάρος τεμαχίου ή μηδενικό κόστος → 0
  assert.equal(costPerGramHundredths({ avgCostHundredths: 1200, baseUnit: { dimension: "count", toBase: 1 } }), 0);
  assert.equal(costPerGramHundredths({ avgCostHundredths: 0, baseUnit: { dimension: "mass", toBase: 1000 } }), 0);
});

test("στόχοι: evaluateTarget και targetFor", () => {
  assert.equal(evaluateTarget(38, { metric: "totalSolids", min: 34, max: 42 }), "ok");
  assert.equal(evaluateTarget(50, { metric: "totalSolids", min: 34, max: 42 }), "high");
  assert.equal(evaluateTarget(30, { metric: "totalSolids", min: 34, max: 42 }), "low");
  assert.equal(evaluateTarget(10, undefined), "none");
  assert.deepEqual(targetFor("cream", "fat"), { metric: "fat", min: 6, max: 12 });
  // άγνωστος τύπος → other
  assert.deepEqual(targetFor("xyz", "fat"), { metric: "fat", min: 0, max: 15 });
});

test("μπάρα ισορροπίας: θέση δείκτη και απόκλιση", () => {
  const t = { metric: "totalSolids", min: 34, max: 42 };
  const ok = balanceBar("totalSolids", 38, t);
  assert.equal(ok.status, "ok");
  assert.ok(ok.marker >= ok.rangeLeft! && ok.marker <= ok.rangeLeft! + ok.rangeWidth!);
  assert.equal(ok.gap, 0);
  const high = balanceBar("totalSolids", 50, t);
  assert.equal(high.status, "high");
  assert.equal(high.gap, 8);
  const low = balanceBar("totalSolids", 30, t);
  assert.equal(low.status, "low");
  assert.equal(low.gap, 4);
  // χωρίς στόχο: δεν σχεδιάζεται εύρος
  const free = balanceBar("x", 10);
  assert.equal(free.status, "none");
  assert.equal(free.rangeLeft, null);
});
