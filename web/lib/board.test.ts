import assert from "node:assert/strict";
import { test } from "node:test";

import { reconcile } from "./board.ts";

test("reconcile: κρατά τη σειρά του χρήστη, βάζει τις νέες κάρτες στη θέση τους, πετά όσες δεν υπάρχουν", () => {
  const initial = { main: ["a", "b"], side: ["c"] };
  assert.deepEqual(reconcile(null, initial, ["a", "b", "c"]), { main: ["a", "b"], side: ["c"], hidden: [] });
  assert.deepEqual(reconcile({ main: ["b"], side: ["a", "gone"], hidden: ["c"] }, initial, ["a", "b", "c"]), { main: ["b"], side: ["a"], hidden: ["c"] });
  assert.deepEqual(reconcile({ main: ["b", "a"], side: [], hidden: [] }, { main: ["a", "b"], side: ["c", "d"] }, ["a", "b", "c", "d"]), { main: ["b", "a"], side: ["c", "d"], hidden: [] });
});
