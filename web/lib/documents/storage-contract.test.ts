import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, check, pathFor, sniff } from "../storage/rules.ts";
import { DOCUMENT_CONFIG, DOCUMENT_ENTITIES } from "./model.ts";

test("generated documents: όλα private, PDF-only και με ξεχωριστό RBAC category", () => {
  const categories = new Set<string>();
  for (const entity of DOCUMENT_ENTITIES) {
    const config = DOCUMENT_CONFIG[entity];
    categories.add(config.category);
    assert.equal(CATEGORIES[config.category].public, false);
    assert.deepEqual(CATEGORIES[config.category].types, ["application/pdf"]);
    assert.ok(config.permission.endsWith(".read"));
  }
  assert.equal(categories.size, DOCUMENT_ENTITIES.length);
});

test("generated documents: tenant path και πραγματικό PDF signature, όχι client MIME", () => {
  for (const category of ["generated_recipe", "generated_wholesale_quote"] as const) {
    const path = pathFor("org-own", category, "random", "../../παραστατικό.pdf");
    assert.ok(path.startsWith(`orgs/org-own/${category}/`));
    assert.equal(path.includes(".."), false);
    const pdf = new TextEncoder().encode("%PDF-1.7\n");
    assert.equal(sniff(pdf), "application/pdf");
    assert.deepEqual(check(category, pdf.length, pdf), { ok: true, contentType: "application/pdf" });
    assert.equal(check(category, 20, new TextEncoder().encode("<html>not pdf</html>")).ok, false);
  }
});
