import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseVivaDevices,
  redactVivaDiscoveryText,
  searchVivaDevices,
  type VivaDeviceDiscoveryConfig,
} from "./device-discovery.ts";
import {
  formatDemoDevicesResult,
  readDemoDevicesConfig,
  runDemoDevicesFromEnv,
} from "../../scripts/viva-demo-devices.ts";

const merchantId = "7164bb99-842a-4b0e-456f-2c653e33c0a5";
const tokenUrl = (demo: boolean) => `https://${demo ? "demo-" : ""}accounts.vivapayments.com/connect/token`;
const searchUrl = (demo: boolean) => `https://${demo ? "demo-" : ""}api.vivapayments.com/ecr/isv/v1/devices:search`;

const config = (environment: "demo" | "production" = "demo"): VivaDeviceDiscoveryConfig => ({
  environment,
  clientId: "demo-client",
  clientSecret: "demo-secret",
  httpTimeoutMs: 1000,
});

const validDevice = () => ({
  merchantId,
  terminalId: "16000010",
  statusId: 1,
  sourceCode: "543679",
  virtualTerminalId: "virtual-terminal",
});

const demoEnv = () => ({
  VIVA_DEMO_ISV_CLIENT_ID: "demo-client",
  VIVA_DEMO_ISV_CLIENT_SECRET: "demo-secret",
  VIVA_DEMO_TERMINAL_MERCHANT_ID: merchantId,
});

test("demo request: ISV OAuth, ακριβές search body και μόνο whitelist metadata", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await searchVivaDevices(config(), { merchantId, statusId: 1, sourceCode: "543679" }, {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === tokenUrl(true)) return Response.json({ access_token: "demo-access-token", expires_in: 3600 });
      if (url === searchUrl(true)) return Response.json([{
        ...validDevice(),
        access_token: "must-not-escape",
        pan: "4111111111111111",
        raw: { merchantSecret: "must-not-escape" },
      }]);
      throw new Error(`unexpected URL ${url}`);
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(result, [validDevice()]);
  assert.equal(Object.hasOwn(result[0], "access_token"), false);
  assert.equal(Object.hasOwn(result[0], "pan"), false);
  assert.equal(Object.hasOwn(result[0], "raw"), false);

  const tokenRequest = calls[0];
  assert.equal(tokenRequest.init?.method, "POST");
  assert.equal(tokenRequest.init?.cache, "no-store");
  assert.equal(new Headers(tokenRequest.init?.headers).get("authorization"), `Basic ${Buffer.from("demo-client:demo-secret").toString("base64")}`);
  assert.equal(tokenRequest.init?.body, "grant_type=client_credentials");

  const searchRequest = calls[1];
  assert.equal(searchRequest.init?.method, "POST");
  assert.equal(searchRequest.init?.cache, "no-store");
  assert.equal(new Headers(searchRequest.init?.headers).get("authorization"), "Bearer demo-access-token");
  assert.deepEqual(JSON.parse(String(searchRequest.init?.body)), { merchantId, statusId: 1, sourceCode: "543679" });
});

test("production request: production hosts και omission προαιρετικών φίλτρων", async () => {
  const calls: string[] = [];
  let searchBody: unknown;
  const result = await searchVivaDevices(config("production"), { merchantId }, {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === tokenUrl(false)) return Response.json({ access_token: "production-token" });
      if (url === searchUrl(false)) {
        searchBody = JSON.parse(String(init?.body));
        return Response.json([]);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.deepEqual(calls, [tokenUrl(false), searchUrl(false)]);
  assert.deepEqual(searchBody, { merchantId });
  assert.deepEqual(result, []);
});

test("strict response validation: malformed root, devices, status και merchant binding", async (t) => {
  const cases: { name: string; body: unknown; message: RegExp }[] = [
    { name: "object αντί για array", body: {}, message: /αναμενόταν array/ },
    { name: "null device", body: [null], message: /μη έγκυρο device/ },
    { name: "merchant που λείπει", body: [{ ...validDevice(), merchantId: undefined }], message: /merchant mismatch/ },
    { name: "merchant άλλου εμπόρου", body: [{ ...validDevice(), merchantId: "other-merchant" }], message: /merchant mismatch/ },
    { name: "κενό terminalId", body: [{ ...validDevice(), terminalId: " " }], message: /μη έγκυρο terminalId/ },
    { name: "μη ακέραιο statusId", body: [{ ...validDevice(), statusId: 1.5 }], message: /μη έγκυρο statusId/ },
    { name: "εκτός spec statusId", body: [{ ...validDevice(), statusId: 8 }], message: /μη έγκυρο statusId/ },
    { name: "λάθος sourceCode", body: [{ ...validDevice(), sourceCode: 42 }], message: /μη έγκυρο sourceCode/ },
    { name: "λάθος virtualTerminalId", body: [{ ...validDevice(), virtualTerminalId: {} }], message: /μη έγκυρο virtualTerminalId/ },
  ];
  for (const c of cases) await t.test(c.name, () => {
    assert.throws(() => parseVivaDevices(c.body, merchantId), c.message);
  });
});

test("προαιρετικά metadata δέχονται null/omission χωρίς να χαλαρώνουν τα required πεδία", () => {
  const device = validDevice() as Record<string, unknown>;
  delete device.sourceCode;
  device.virtualTerminalId = null;
  assert.deepEqual(parseVivaDevices([device], merchantId), [{
    ...validDevice(),
    sourceCode: null,
    virtualTerminalId: null,
  }]);
});

test("strict request validation απορρίπτει κενά IDs και μη έγκυρα φίλτρα πριν από network", async (t) => {
  const cases = [
    { name: "merchantId", input: { merchantId: " " } },
    { name: "sourceCode", input: { merchantId, sourceCode: " " } },
    { name: "statusId", input: { merchantId, statusId: 8 as 1 } },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    let calls = 0;
    await assert.rejects(searchVivaDevices(config(), c.input, {
      fetch: async () => { calls += 1; throw new Error("network"); },
    }), /Viva devices:/);
    assert.equal(calls, 0);
  });
});

test("malformed token και search JSON απορρίπτονται χωρίς raw body leakage", async (t) => {
  await t.test("token χωρίς access_token", async () => {
    await assert.rejects(searchVivaDevices(config(), { merchantId }, {
      fetch: async () => Response.json({ access_token: 42 }),
    }), /λείπει το access_token/);
  });

  await t.test("μη έγκυρο token JSON", async () => {
    await assert.rejects(searchVivaDevices(config(), { merchantId }, {
      fetch: async () => new Response('{"access_token":"secret', { status: 200 }),
    }), /Viva devices token: μη έγκυρο JSON/);
  });

  await t.test("μη έγκυρο search JSON", async () => {
    await assert.rejects(searchVivaDevices(config(), { merchantId }, {
      fetch: async (input) => String(input) === tokenUrl(true)
        ? Response.json({ access_token: "demo-access-token" })
        : new Response('[{"terminalId":"secret', { status: 200 }),
    }), /Viva devices search: μη έγκυρο JSON/);
  });
});

test("HTTP errors δεν περιέχουν response body, credentials ή bearer token", async (t) => {
  await t.test("token 401", async () => {
    await assert.rejects(searchVivaDevices(config(), { merchantId }, {
      fetch: async () => Response.json({ message: "demo-secret must not escape" }, { status: 401 }),
    }), (error: Error) => {
      assert.equal(error.message, "Viva devices token: HTTP 401");
      assert.ok(!error.message.includes("demo-secret"));
      return true;
    });
  });

  await t.test("search 503", async () => {
    await assert.rejects(searchVivaDevices(config(), { merchantId }, {
      fetch: async (input) => String(input) === tokenUrl(true)
        ? Response.json({ access_token: "demo-access-token" })
        : Response.json({ message: "demo-access-token must not escape" }, { status: 503 }),
    }), (error: Error) => {
      assert.equal(error.message, "Viva devices search: HTTP 503");
      assert.ok(!error.message.includes("demo-access-token"));
      return true;
    });
  });
});

test("network error redaction καλύπτει credentials, basic και bearer", async () => {
  await assert.rejects(searchVivaDevices(config(), { merchantId }, {
    fetch: async (input) => {
      if (String(input) === tokenUrl(true)) return Response.json({ access_token: "demo-access-token" });
      throw new Error("demo-client demo-secret Bearer demo-access-token");
    },
  }), (error: Error) => {
    assert.equal(error.message, "Viva devices search: [REDACTED] [REDACTED] Bearer [REDACTED]");
    return true;
  });

  const basic = Buffer.from("demo-client:demo-secret").toString("base64");
  const redacted = redactVivaDiscoveryText(
    `Basic ${basic} Bearer abc.def {"access_token":"token-value","client_id":"demo-client"}`,
    ["demo-client", "demo-secret", basic],
  );
  assert.equal(redacted, 'Basic [REDACTED] Bearer [REDACTED] {"access_token":"[REDACTED]","client_id":"[REDACTED]"}');
});

test("token και search έχουν ανεξάρτητο bounded timeout", async (t) => {
  for (const operation of ["token", "search"] as const) await t.test(operation, async () => {
    await assert.rejects(searchVivaDevices({ ...config(), httpTimeoutMs: 5 }, { merchantId }, {
      fetch: async (input, init) => {
        if (operation === "search" && String(input) === tokenUrl(true))
          return Response.json({ access_token: "demo-access-token" });
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    }), new RegExp(`Viva devices ${operation}: timeout μετά από 5 ms`));
  });
});

test("demo discovery τρέχει χωρίς RUN_DEMO_SALE και κάνει μόνο token/search", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const env = demoEnv();
  assert.equal("VIVA_SANDBOX_CONFIRM" in env, false);
  const result = await runDemoDevicesFromEnv(env, {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === tokenUrl(true)) return Response.json({ access_token: "demo-access-token" });
      if (url === searchUrl(true)) return Response.json([validDevice()]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.deepEqual(result, { status: "passed", devices: [validDevice()] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.url.includes("transactions") && !call.url.includes("sessions")));
  const searchBody = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
  assert.deepEqual(searchBody, { merchantId });
  assert.equal(Object.hasOwn(searchBody, "sessionId"), false);
  assert.equal(Object.hasOwn(searchBody, "amount"), false);
  if (result.status === "passed") {
    const output = formatDemoDevicesResult(result);
    assert.ok(!output.includes("demo-secret"));
    assert.ok(!output.includes("demo-access-token"));
  }
});

test("demo discovery χωρίς credentials: NOT RUN και μηδέν network calls", async () => {
  let calls = 0;
  const result = await runDemoDevicesFromEnv({}, {
    fetch: async () => { calls += 1; throw new Error("network"); },
  });
  assert.equal(result.status, "not_run");
  assert.equal(calls, 0);
});

test("demo config δεν απαιτεί terminalId ή sale confirmation και έχει bounded timeout", () => {
  const ready = readDemoDevicesConfig(demoEnv());
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") {
    assert.equal(ready.config.merchantId, merchantId);
    assert.equal(ready.config.httpTimeoutMs, 10_000);
  }
  assert.throws(() => readDemoDevicesConfig({ ...demoEnv(), VIVA_DEMO_HTTP_TIMEOUT_MS: "0" }), /1000\.\.30000/);
});
