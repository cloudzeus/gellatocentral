import assert from "node:assert/strict";
import { test } from "node:test";
import { planProductDeletion, type ProductDeletionRow } from "./products.ts";

const product = (id: string, lines = 0): ProductDeletionRow => ({ id, _count: { lines } });

test("διαγραφή προϊόντων: τα αχρησιμοποίητα σβήνουν και τα πουλημένα κρύβονται", () => {
  const plan = planProductDeletion(["new", "sold", "draft"], [product("new"), product("sold", 4), product("draft", 1)]);
  assert.deepEqual(plan, { deleteIds: ["new"], hideIds: ["sold", "draft"], missingIds: [] });
});

test("διαγραφή προϊόντων: διπλά ids μετράνε μία φορά", () => {
  const plan = planProductDeletion(["new", "new", "sold", "sold"], [product("new"), product("sold", 2)]);
  assert.deepEqual(plan, { deleteIds: ["new"], hideIds: ["sold"], missingIds: [] });
});

test("διαγραφή προϊόντων: ξένο ή παλιό id αναφέρεται ως missing και δεν διαγράφεται", () => {
  const plan = planProductDeletion(["new", "other-org", "removed"], [product("new")]);
  assert.deepEqual(plan, { deleteIds: ["new"], hideIds: [], missingIds: ["other-org", "removed"] });
});
