import assert from "node:assert/strict";
import { test } from "node:test";
import { filterParam, listParams } from "./paging.ts";

test("listParams: δέχεται μόνο επιτρεπόμενη ταξινόμηση και φίλτρα", () => {
  const sp = { q: "  a ", page: "3", sort: "total", dir: "asc", method: "CARD" };
  const p = listParams(sp, 10, ["total", "date"]);
  assert.deepEqual([p.q, p.page, p.skip, p.sort, p.dir], ["a", 3, 20, "total", "asc"]);
  assert.equal(filterParam(sp, "method", ["CASH", "CARD"]), "CARD");
  const evil = { page: "-4", sort: "password", dir: "x", method: "DROP" };
  const bad = listParams(evil, 10, ["total"]);
  assert.deepEqual([bad.page, bad.sort, bad.dir, filterParam(evil, "method", ["CASH", "CARD"])], [1, undefined, "desc", undefined]);
});
