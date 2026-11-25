import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";
import type { StockContext } from "../stock-scope.ts";
import type { DocumentRouteDeps } from "./route-handler.ts";
import type { DocumentModel, LoadedDocument } from "./model.ts";

type ResolveHooks = { registerHooks(hooks: { resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown): unknown }): void };
(nodeModule as unknown as ResolveHooks).registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || /\.[a-z]+$/i.test(specifier)) throw error;
      return nextResolve(`${specifier}.${specifier.startsWith(".") ? "ts" : "js"}`, context);
    }
  },
});
const { handleDocumentRequest } = await import("./route-handler.ts");

const ctx: StockContext = { orgId: "org-own", membershipId: "member-1", userId: "user-1", userName: "Tester", permissions: ["recipes.read"], storeIds: [], warehouseIds: [], can: () => true };
const model: DocumentModel = { entityType: "recipe", entityId: "recipe-1", filename: "recipe-1", title: "Συνταγή", brand: { name: "Tenant", legalName: null, vatNumber: "123", address: null, city: null, postalCode: null, phone: null, labelExtraText: null }, sections: [] };
const loaded: LoadedDocument = { model, scope: { warehouseId: "warehouse-1" } };

function deps(overrides: Partial<DocumentRouteDeps> = {}): DocumentRouteDeps {
  return {
    authorize: async () => ({ ctx }),
    load: async () => loaded,
    storePdf: async () => ({ id: "file-private", name: "recipe.pdf", contentType: "application/pdf", size: 1234, url: "/api/files/file-private" }),
    exportSchedule: () => ({ data: "test", contentType: "text/csv; charset=utf-8", name: "schedule.csv" }),
    ...overrides,
  };
}

test("route: χωρίς συνεδρία 401 και καμία ανάγνωση/δημιουργία", async () => {
  let reads = 0;
  const response = await handleDocumentRequest(new Request("https://app.test/api/documents/recipe/recipe-1", { method: "POST" }), "recipe", "recipe-1", deps({ authorize: async () => ({ error: Response.json({}, { status: 401 }) }), load: async () => { reads += 1; return loaded; } }));
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

test("route: ελλιπές RBAC permission 403 πριν από το entity lookup", async () => {
  let reads = 0;
  const response = await handleDocumentRequest(new Request("https://app.test/api/documents/recipe/recipe-1", { method: "POST" }), "recipe", "recipe-1", deps({ authorize: async () => ({ error: Response.json({}, { status: 403 }) }), load: async () => { reads += 1; return loaded; } }));
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test("route: ξένο/ανύπαρκτο tenant entity 404 χωρίς αποθήκευση", async () => {
  let writes = 0;
  const response = await handleDocumentRequest(new Request("https://app.test/api/documents/recipe/foreign", { method: "POST" }), "recipe", "foreign", deps({ load: async () => null, storePdf: async () => { writes += 1; throw new Error("forbidden write"); } }));
  assert.equal(response.status, 404);
  assert.equal(writes, 0);
});

test("route: PDF response περιέχει μόνο private authenticated download URL", async () => {
  const response = await handleDocumentRequest(new Request("https://app.test/api/documents/recipe/recipe-1", { method: "POST" }), "recipe", "recipe-1", deps());
  assert.equal(response.status, 200);
  const body = await response.json() as { file: { url: string }; delivery: { externalSending: string } };
  assert.equal(body.file.url, "/api/files/file-private");
  assert.equal(body.file.url.startsWith("http"), false);
  assert.equal(body.delivery.externalSending, "NOT_SENT");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("route: ξαναελέγχεται το warehouse/store scope του loaded entity", async () => {
  const scopes: unknown[] = [];
  const response = await handleDocumentRequest(new Request("https://app.test/api/documents/recipe/recipe-1", { method: "POST" }), "recipe", "recipe-1", deps({ authorize: async (_permission, scope) => { if (scope) scopes.push(scope); return { ctx }; } }));
  assert.equal(response.status, 200);
  assert.deepEqual(scopes, [{ warehouseId: "warehouse-1" }]);
});

test("route: άγνωστο entity, format και cross-origin POST απορρίπτονται", async () => {
  const unknown = await handleDocumentRequest(new Request("https://app.test/x", { method: "POST" }), "unknown", "id", deps());
  const format = await handleDocumentRequest(new Request("https://app.test/x?format=html", { method: "POST" }), "recipe", "id", deps());
  const origin = await handleDocumentRequest(new Request("https://app.test/x", { method: "POST", headers: { origin: "https://evil.test", host: "app.test" } }), "recipe", "id", deps());
  assert.deepEqual([unknown.status, format.status, origin.status], [404, 400, 403]);
});

const quoteModel: DocumentModel = { ...model, entityType: "wholesale_quote", entityId: "quote-1", filename: "wholesale-quote-P-1", title: "Προσφορά χονδρικής ΠΡ-1" };
const quoteLoaded: LoadedDocument = { model: quoteModel, scope: { storeId: "store-1", warehouseId: "warehouse-1" } };
const quoteRequest = () => new Request("https://app.test/api/documents/wholesale_quote/quote-1", { method: "POST" });

test("route wholesale_quote: χωρίς συνεδρία 401 και χωρίς entity lookup ή PDF", async () => {
  let reads = 0, writes = 0;
  const response = await handleDocumentRequest(quoteRequest(), "wholesale_quote", "quote-1", deps({
    authorize: async () => ({ error: Response.json({}, { status: 401 }) }),
    load: async () => { reads += 1; return quoteLoaded; },
    storePdf: async () => { writes += 1; throw new Error("forbidden write"); },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual([reads, writes], [0, 0]);
});

test("route wholesale_quote: χωρίς wholesale.read 403 πριν από το entity lookup", async () => {
  let reads = 0;
  const permissions: unknown[] = [];
  const response = await handleDocumentRequest(quoteRequest(), "wholesale_quote", "quote-1", deps({
    authorize: async (permission) => { permissions.push(permission); return { error: Response.json({}, { status: 403 }) }; },
    load: async () => { reads += 1; return quoteLoaded; },
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(permissions, ["wholesale.read"]);
  assert.equal(reads, 0);
});

test("route wholesale_quote: cross-tenant/ανύπαρκτη προσφορά 404 χωρίς αποθήκευση", async () => {
  let writes = 0;
  const response = await handleDocumentRequest(quoteRequest(), "wholesale_quote", "quote-foreign", deps({
    load: async () => null,
    storePdf: async () => { writes += 1; throw new Error("forbidden write"); },
  }));
  assert.equal(response.status, 404);
  assert.equal(writes, 0);
});

test("route wholesale_quote: εκτός store/warehouse scope 403 και καμία εγγραφή", async () => {
  let writes = 0;
  const scopes: unknown[] = [];
  const response = await handleDocumentRequest(quoteRequest(), "wholesale_quote", "quote-1", deps({
    authorize: async (_permission, scope) => {
      if (scope) { scopes.push(scope); return { error: Response.json({}, { status: 403 }) }; }
      return { ctx };
    },
    load: async () => quoteLoaded,
    storePdf: async () => { writes += 1; throw new Error("forbidden write"); },
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(scopes, [{ storeId: "store-1", warehouseId: "warehouse-1" }]);
  assert.equal(writes, 0);
});

test("route wholesale_quote: επιτυχία περνά το scope στο private output και μένει NOT_SENT", async () => {
  const permissions: unknown[] = [];
  let storedScope: unknown;
  const response = await handleDocumentRequest(quoteRequest(), "wholesale_quote", "quote-1", deps({
    authorize: async (permission) => { permissions.push(permission); return { ctx }; },
    load: async () => quoteLoaded,
    storePdf: async (_context, document, scope) => {
      storedScope = scope;
      assert.equal(document.entityType, "wholesale_quote");
      return { id: "file-quote", name: "quote.pdf", contentType: "application/pdf", size: 2000, url: "/api/files/file-quote" };
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(permissions, ["wholesale.read", "wholesale.read"]);
  assert.deepEqual(storedScope, { storeId: "store-1", warehouseId: "warehouse-1" });
  const body = await response.json() as { file: { url: string }; delivery: { status: string; externalSending: string } };
  assert.equal(body.file.url, "/api/files/file-quote");
  assert.deepEqual(body.delivery, { status: "STORED", externalSending: "NOT_SENT" });
});
