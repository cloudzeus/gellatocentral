import assert from "node:assert/strict";
import { test } from "node:test";
import { PASTRY_CATEGORY_TREE, type PastryCategorySeed } from "./pastry-categories.ts";

test("το αρχικό δέντρο ζαχαροπλαστικής είναι πλήρες, τριών επιπέδων και χωρίς διπλά sibling ονόματα", () => {
  const walk = (nodes: PastryCategorySeed[], depth: number): number => {
    assert.equal(new Set(nodes.map((n) => n.name)).size, nodes.length);
    assert.ok(depth <= 3);
    return nodes.reduce((sum, node) => sum + 1 + (node.children ? walk(node.children, depth + 1) : 0), 0);
  };
  assert.ok(PASTRY_CATEGORY_TREE.length >= 12);
  assert.ok(walk(PASTRY_CATEGORY_TREE, 1) >= 150);
  for (const root of PASTRY_CATEGORY_TREE) assert.ok(root.children?.length, `Η ${root.name} χρειάζεται υποκατηγορίες`);
});
