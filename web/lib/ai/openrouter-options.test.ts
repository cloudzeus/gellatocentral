// Κατάλογος OpenRouter: καθαρισμός δεδομένων, endpoints και routing χαμηλού κόστους.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_MODEL, catalogOptions, modelChoices, routingOptions } from "./openrouter-options.ts";

test("ο κατάλογος κρατά έγκυρα μοντέλα, μοναδικά id και πραγματικές τιμές ανά εκατομμύριο tokens", () => {
  const options = catalogOptions({ data: [
    { id: "acme/cheap", name: "Acme Cheap", pricing: { prompt: "0.0000001", completion: "0.0000002" } },
    { id: "acme/cheap", name: "Διπλό", pricing: { prompt: "1", completion: "1" } },
    { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
    { id: "χωρίς-έγκυρο-id", pricing: { prompt: "0", completion: "0" } },
    null,
  ] }, "chat");
  assert.deepEqual(options, [["acme/cheap", "Acme Cheap — acme/cheap · $0.1/$0.2 ανά 1M tokens"]]);
});

test("τα embeddings δείχνουν μόνο κόστος εισόδου και δέχονται rolling alias", () => {
  const options = catalogOptions({ data: [{ id: "~acme/embed-latest", pricing: { prompt: "0.00000002" } }] }, "embed");
  assert.deepEqual(options, [["~acme/embed-latest", "~acme/embed-latest · $0.02 ανά 1M tokens"]]);
});

test("η αυτόματη επιλογή ζητά χαμηλό κόστος μοντέλου και παρόχου χωρίς να χαλά το απόρρητο", () => {
  assert.deepEqual(routingOptions(AUTO_MODEL, true), {
    provider: { data_collection: "deny", zdr: true, sort: "price" },
    plugins: [{ id: "auto-router", cost_tier: "low" }],
  });
  assert.deepEqual(routingOptions(AUTO_MODEL, false), {
    provider: { sort: "price" },
    plugins: [{ id: "auto-router", cost_tier: "low" }],
  });
});

test("το web plugin συνυπάρχει με τον φθηνό auto-router και το απόρρητο", () => {
  assert.deepEqual(routingOptions(AUTO_MODEL, true, [{ id: "web", max_results: 5 }]), {
    provider: { data_collection: "deny", zdr: true, sort: "price" },
    plugins: [{ id: "auto-router", cost_tier: "low" }, { id: "web", max_results: 5 }],
  });
});

test("σταθερό μοντέλο: δεν αλλάζει η υπάρχουσα δρομολόγηση", () => {
  assert.deepEqual(routingOptions("acme/chat", true), { provider: { data_collection: "deny", zdr: true } });
  assert.deepEqual(routingOptions("acme/chat", false), {});
});

test("οι λίστες έρχονται από τα σωστά API endpoints και το κλειδί μένει μόνο στην κεφαλίδα", async (t) => {
  const calls: { url: string; authorization: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    const chat = url.includes("/models/user?");
    return new Response(JSON.stringify({ data: chat
      ? [{ id: "acme/chat", name: "Chat", pricing: { prompt: "0.000001", completion: "0.000002" } }]
      : [{ id: "acme/embed", name: "Embed", pricing: { prompt: "0.00000002" } }] }), { status: 200 });
  });
  const result = await modelChoices("secret-key");
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.url.includes("/models/user?") && c.url.includes("sort=pricing-low-to-high")));
  assert.ok(calls.some((c) => c.url.endsWith("/embeddings/models")));
  assert.ok(calls.every((c) => c.authorization === "Bearer secret-key"));
  assert.equal(result.chat?.[0][0], AUTO_MODEL);
  assert.equal(result.chat?.[1][0], "acme/chat");
  assert.equal(result.embed?.[0][0], "acme/embed");
  assert.deepEqual(result.failed, []);
});

test("αποτυχία catalogue: η φόρμα παίρνει σήμαση fallback αντί να σπάσει", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const result = await modelChoices("");
  assert.equal(result.chat, undefined);
  assert.equal(result.embed, undefined);
  assert.deepEqual(result.failed, ["συνομιλίας", "embeddings"]);
});
