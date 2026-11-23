import assert from "node:assert/strict";
import { test } from "node:test";
import { descendantCategoryIds, flattenTradeCategories, moveTradeCategory, tradeCategoryLayoutError, type TradeCategoryRecord } from "./trade-category-tree.ts";

const rows = (): TradeCategoryRecord[] => [
  { id: "fruit", name: "Φρούτα", parentId: null, position: 0, active: true },
  { id: "chocolate", name: "Σοκολάτα", parentId: null, position: 1, active: true },
  { id: "purees", name: "Πολτοί", parentId: "fruit", position: 0, active: true },
  { id: "dried", name: "Αποξηραμένα", parentId: "fruit", position: 1, active: true },
  { id: "raspberry", name: "Φράουλα", parentId: "purees", position: 0, active: true },
  { id: "couverture", name: "Κουβερτούρες", parentId: "chocolate", position: 0, active: true },
];

test("flatten: προτεραιότητα γονέα-παιδιού και σωστά βάθη", () => {
  assert.deepEqual(flattenTradeCategories(rows()).map(({ category, depth }) => [category.id, depth]), [
    ["fruit", 0], ["purees", 1], ["raspberry", 2], ["dried", 1], ["chocolate", 0], ["couverture", 1],
  ]);
});

test("move: αλλάζει σειρά χωρίς να αφήνει κενά", () => {
  const next = moveTradeCategory(rows(), "dried", { parentId: "fruit", beforeId: "purees" });
  assert.deepEqual(next.filter((c) => c.parentId === "fruit").sort((a, b) => a.position - b.position).map((c) => [c.id, c.position]), [["dried", 0], ["purees", 1]]);
});

test("move: αλλαγή γονέα κρατά το υποδέντρο και κλείνει το παλιό επίπεδο", () => {
  const next = moveTradeCategory(rows(), "purees", { parentId: "chocolate", afterId: "couverture" });
  assert.equal(next.find((c) => c.id === "purees")?.parentId, "chocolate");
  assert.equal(next.find((c) => c.id === "purees")?.position, 1);
  assert.equal(next.find((c) => c.id === "raspberry")?.parentId, "purees");
  assert.equal(next.find((c) => c.id === "dried")?.position, 0);
});

test("move: απορρίπτει μετακίνηση σε απόγονο", () => {
  assert.throws(() => moveTradeCategory(rows(), "fruit", { parentId: "raspberry" }), /απόγονό/);
  assert.deepEqual([...descendantCategoryIds(rows(), "fruit")].sort(), ["dried", "purees", "raspberry"]);
});

test("validation: απαιτεί πλήρες, έγκυρο και ακυκλικό layout", () => {
  const current = rows();
  assert.equal(tradeCategoryLayoutError(current, current), null);
  assert.match(tradeCategoryLayoutError(current.slice(1), current) ?? "", /ανανέωσε/);
  const cycle = current.map((c) => c.id === "raspberry" ? { ...c, parentId: "fruit" } : c.id === "fruit" ? { ...c, parentId: "raspberry" } : c);
  assert.match(tradeCategoryLayoutError(cycle, current) ?? "", /κύκλο/);
  const duplicate = [...current, { ...current[0], id: "other" }];
  const existing = [...current, { ...current[0], id: "other" }];
  assert.match(tradeCategoryLayoutError(duplicate, existing) ?? "", /δύο κατηγορίες/);
});
