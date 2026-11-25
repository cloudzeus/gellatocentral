import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  redactVivaDiscoveryText,
  searchVivaDevices,
  type VivaTerminalMetadata,
} from "../lib/viva/device-discovery.ts";

const requiredEnv = [
  "VIVA_DEMO_ISV_CLIENT_ID",
  "VIVA_DEMO_ISV_CLIENT_SECRET",
  "VIVA_DEMO_TERMINAL_MERCHANT_ID",
] as const;

export type DemoDevicesConfig = {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  httpTimeoutMs: number;
};

export type DemoDevicesDeps = {
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
};

export type DemoDevicesEnvResult =
  | { status: "not_run"; reason: string }
  | { status: "passed"; devices: VivaTerminalMetadata[] };

/** Διαβάζει μόνο ρητά demo secrets· δεν ακουμπά app settings, .env ή βάση. */
export function readDemoDevicesConfig(env: Readonly<Record<string, string | undefined>>):
  | { status: "ready"; config: DemoDevicesConfig }
  | { status: "not_run"; reason: string } {
  const missing = requiredEnv.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { status: "not_run", reason: `λείπουν: ${missing.join(", ")}` };
  return {
    status: "ready",
    config: {
      clientId: env.VIVA_DEMO_ISV_CLIENT_ID!,
      clientSecret: env.VIVA_DEMO_ISV_CLIENT_SECRET!,
      merchantId: env.VIVA_DEMO_TERMINAL_MERCHANT_ID!,
      httpTimeoutMs: boundedTimeout(env.VIVA_DEMO_HTTP_TIMEOUT_MS),
    },
  };
}

function boundedTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 10_000;
  if (!/^\d+$/.test(raw)) throw new Error("VIVA_DEMO_HTTP_TIMEOUT_MS: απαιτείται ακέραιος");
  const value = Number(raw);
  if (value < 1_000 || value > 30_000) throw new Error("VIVA_DEMO_HTTP_TIMEOUT_MS: επιτρεπόμενο εύρος 1000..30000");
  return value;
}

/** Read-only demo discovery χωρίς sale gate: μόνο token και devices:search, ποτέ session. */
export async function runDemoDevicesFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  deps: DemoDevicesDeps = {},
): Promise<DemoDevicesEnvResult> {
  const gate = readDemoDevicesConfig(env);
  if (gate.status === "not_run") return gate;
  const devices = await searchVivaDevices({
    environment: "demo",
    clientId: gate.config.clientId,
    clientSecret: gate.config.clientSecret,
    httpTimeoutMs: gate.config.httpTimeoutMs,
  }, { merchantId: gate.config.merchantId }, deps);
  return { status: "passed", devices };
}

export function formatDemoDevicesResult(result: Extract<DemoDevicesEnvResult, { status: "passed" }>): string {
  return `PASS: ${JSON.stringify(result.devices)}`;
}

async function main(): Promise<number> {
  let gate: ReturnType<typeof readDemoDevicesConfig>;
  try {
    gate = readDemoDevicesConfig(process.env);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (gate.status === "not_run") {
    console.log(`NOT RUN: ${gate.reason}`);
    return 0;
  }

  const config = gate.config;
  console.log("RUNNING: read-only Viva demo device discovery, χωρίς sale ή session.");
  try {
    const result = await runDemoDevicesFromEnv(process.env, { fetch });
    if (result.status === "not_run") return 0;
    console.log(formatDemoDevicesResult(result));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${redactVivaDiscoveryText(message, [config.clientId, config.clientSecret, config.merchantId])}`);
    return 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) void main().then((code) => { process.exitCode = code; });
