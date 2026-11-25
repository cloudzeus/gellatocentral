import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { test } from "node:test";
import type { StockContext } from "../stock-scope.ts";
import type { LoadedDocument } from "./model.ts";
import type { DocumentDeliveryRouteDeps } from "./delivery-route.ts";

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
const { handleDocumentDeliveryRequest } = await import("./delivery-route.ts");
const { DocumentDeliveryError } = await import("../document-delivery.ts");

const ctx: StockContext = { orgId: "org-own", membershipId: "member-1", userId: "user-1", userName: "Tester", permissions: ["wholesale.read", "wholesale.edit"], storeIds: [], warehouseIds: [], can: () => true };
const loaded: LoadedDocument = {
  model: {
    entityType: "wholesale_quote", entityId: "quote-1", filename: "quote-1", title: "Προσφορά 1",
    brand: { name: "Tenant", legalName: null, vatNumber: "123456789", address: null, city: null, postalCode: null, phone: null, labelExtraText: null }, sections: [],
  },
  scope: { storeId: "store-1", warehouseId: "warehouse-1" },
};

function deps(overrides: Partial<DocumentDeliveryRouteDeps> = {}): DocumentDeliveryRouteDeps {
  return {
    authorize: async () => ({ ctx }),
    load: async () => loaded,
    list: async () => ({ externalSendingEnabled: true, recipients: [{ id: "party-1", name: "Πελάτης", email: "p•••@e•••.com", viber: null, viberReason: "Χωρίς subscriber ID" }] }),
    deliver: async () => ({ status: "SENT", deliveryStatus: "SENT", detail: "Provider accepted" }),
    ...overrides,
  };
}

function request(body: unknown = { channel: "email", recipientId: "party-1", confirm: true }, origin = "https://app.test") {
  return new Request("https://app.test/api/documents/wholesale_quote/quote-1/delivery", {
    method: "POST", headers: { "content-type": "application/json", host: "app.test", origin }, body: JSON.stringify(body),
  });
}

test("delivery route: 401 πριν από entity lookup και χωρίς provider", async () => {
  let loads = 0, deliveries = 0;
  const response = await handleDocumentDeliveryRequest(request(), "wholesale_quote", "quote-1", deps({
    authorize: async () => ({ error: Response.json({}, { status: 401 }) }),
    load: async () => { loads += 1; return loaded; },
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual([loads, deliveries], [0, 0]);
});

test("delivery route: 403 read permission πριν από entity lookup", async () => {
  let loads = 0;
  const response = await handleDocumentDeliveryRequest(request(), "wholesale_quote", "quote-1", deps({
    authorize: async () => ({ error: Response.json({}, { status: 403 }) }),
    load: async () => { loads += 1; return loaded; },
  }));
  assert.equal(response.status, 403);
  assert.equal(loads, 0);
});

test("delivery route: store/warehouse scope 403 και καμία αποστολή", async () => {
  const scoped: unknown[] = [];
  let deliveries = 0;
  const response = await handleDocumentDeliveryRequest(request(), "wholesale_quote", "quote-1", deps({
    authorize: async (_permission, scope) => {
      if (!scope) return { ctx };
      scoped.push(scope);
      return { error: Response.json({}, { status: 403 }) };
    },
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(scoped, [{ storeId: "store-1", warehouseId: "warehouse-1" }]);
  assert.equal(deliveries, 0);
});

test("delivery route: read access δεν αρκεί, write RBAC 403 πριν από provider", async () => {
  const permissions: string[] = [];
  let deliveries = 0;
  const response = await handleDocumentDeliveryRequest(request(), "wholesale_quote", "quote-1", deps({
    authorize: async (permission, scope) => {
      if (permission === "wholesale.edit") return { error: Response.json({}, { status: 403 }) };
      if (permission === "wholesale.read" && scope) return { ctx };
      permissions.push(permission);
      return { ctx };
    },
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(response.status, 403);
  assert.equal(deliveries, 0);
});

test("delivery route: cross-origin POST απορρίπτεται πριν από auth/provider", async () => {
  let authCalls = 0, deliveries = 0;
  const response = await handleDocumentDeliveryRequest(request(undefined, "https://evil.test"), "wholesale_quote", "quote-1", deps({
    authorize: async () => { authCalls += 1; return { ctx }; },
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(response.status, 403);
  assert.deepEqual([authCalls, deliveries], [0, 0]);
});

test("delivery route: confirm είναι υποχρεωτικό boolean και false δεν αποστέλλει", async () => {
  let deliveries = 0;
  const missing = await handleDocumentDeliveryRequest(request({ channel: "email", recipientId: "party-1" }), "wholesale_quote", "quote-1", deps({
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(missing.status, 400);
  const rejected = await handleDocumentDeliveryRequest(request({ channel: "email", recipientId: "party-1", confirm: false }), "wholesale_quote", "quote-1", deps({
    deliver: async (_ctx, _loaded, input) => {
      deliveries += 1;
      assert.equal(input.confirm, false);
      throw new DocumentDeliveryError("CONFIRMATION_REQUIRED", "Απαιτείται επιβεβαίωση");
    },
  }));
  assert.equal(rejected.status, 400);
  assert.equal(deliveries, 1);
});

test("delivery route: same-origin confirmed POST καλεί μία φορά delivery με write context", async () => {
  let deliveries = 0;
  const response = await handleDocumentDeliveryRequest(request(), "wholesale_quote", "quote-1", deps({
    deliver: async (writeCtx, document, input) => {
      deliveries += 1;
      assert.equal(writeCtx, ctx);
      assert.equal(document, loaded);
      assert.deepEqual(input, { channel: "email", recipientId: "party-1", confirm: true });
      return { status: "SENT", deliveryStatus: "SENT", detail: "Provider accepted" };
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(deliveries, 1);
});

test("delivery route: GET επιστρέφει masked recipients και canSend, χωρίς delivery", async () => {
  let deliveries = 0;
  const response = await handleDocumentDeliveryRequest(new Request("https://app.test/api/documents/wholesale_quote/quote-1/delivery"), "wholesale_quote", "quote-1", deps({
    authorize: async () => ({ ctx: { ...ctx, can: () => false } }),
    deliver: async () => { deliveries += 1; throw new Error("forbidden provider"); },
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { canSend: boolean; recipients: { email: string }[] };
  assert.equal(body.canSend, false);
  assert.equal(body.recipients[0]?.email, "p•••@e•••.com");
  assert.equal(deliveries, 0);
});
