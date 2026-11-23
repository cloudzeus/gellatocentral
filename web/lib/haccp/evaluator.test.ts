import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHaccp, type HaccpRecordInput } from "./evaluator.ts";
import { HACCP_FORMS } from "./forms.ts";
import { HACCP_SOURCE_MAP } from "./sources.ts";

const now = new Date("2026-11-23T09:00:00.000Z");
const base = { storeId: null, status: "COMPLETED", result: "CONFORMING", correctiveAction: null, notes: null };
const covered = HACCP_FORMS.filter((item) => item.weight > 0).map((item): HaccpRecordInput => ({ ...base, templateId: item.id, occurredAt: now }));

test("κενός tenant: κανένα τεχνητό σκορ και σαφείς υποχρεώσεις", () => {
  const result = evaluateHaccp({ now, records: [], devices: [], postedPurchaseCount: 0 });
  assert.equal(result.score, 0);
  assert.ok(result.findings.some((item) => item.id === "missing-haccp-plan"));
  assert.ok(result.findings.every((item) => item.action.length > 10));
});

test("ολοκληρωμένες πρόσφατες καταχωρίσεις καλύπτουν το σταθμισμένο σύνολο", () => {
  const result = evaluateHaccp({ now, records: covered, devices: [], postedPurchaseCount: 1 });
  assert.equal(result.score, 100);
  assert.equal(result.findings.length, 0);
});

test("πρόχειρο και Μ.Ο. δεν θεωρούνται τεκμηρίωση", () => {
  const records = covered.map((item) => item.templateId === "haccp-plan" ? { ...item, status: "DRAFT" } : item.templateId === "process-flow" ? { ...item, result: "NA" } : item);
  const result = evaluateHaccp({ now, records, devices: [], postedPurchaseCount: 0 });
  assert.ok(result.findings.some((item) => item.id === "missing-haccp-plan"));
  assert.ok(result.findings.some((item) => item.id === "missing-process-flow"));
  assert.ok(result.score < 100);
});

test("παλιό σχέδιο επισημαίνεται και βαθμολογείται μερικώς", () => {
  const records = covered.map((item) => item.templateId === "haccp-plan" ? { ...item, occurredAt: new Date("2024-01-01") } : item);
  const result = evaluateHaccp({ now, records, devices: [], postedPurchaseCount: 0 });
  assert.ok(result.findings.some((item) => item.id === "stale-haccp-plan"));
  assert.ok(result.score > 0 && result.score < 100);
});

test("συσκευή χωρίς μέτρηση, παλιά μέτρηση και εκτός ορίων", () => {
  const noReading = evaluateHaccp({ now, records: covered, postedPurchaseCount: 0, devices: [{ id: "a", name: "Ψυγείο Α", storeId: "s", tempMin: 0, tempMax: 4, readings: [] }] });
  assert.ok(noReading.findings.some((item) => item.id === "device-no-reading-a"));
  const out = evaluateHaccp({ now, records: covered, postedPurchaseCount: 0, devices: [{ id: "b", name: "Ψυγείο Β", storeId: "s", tempMin: 0, tempMax: 4, readings: [{ value: 8, at: new Date("2026-11-20") }] }] });
  assert.ok(out.findings.some((item) => item.id === "device-limit-b"));
  assert.ok(out.findings.some((item) => item.id === "device-stale-b"));
});

test("απόκλιση χωρίς διορθωτική ενέργεια είναι κρίσιμο εύρημα", () => {
  const result = evaluateHaccp({ now, records: [...covered, { ...base, templateId: "cold-storage", occurredAt: now, result: "DEVIATION" }], devices: [], postedPurchaseCount: 0 });
  assert.ok(result.findings.some((item) => item.id.startsWith("deviation-") && item.severity === "HIGH"));
});

test("το φίλτρο καταστήματος δεν δανείζεται μετρήσεις άλλου καταστήματος", () => {
  const result = evaluateHaccp({ now, storeId: "s1", records: covered, postedPurchaseCount: 0, devices: [{ id: "s2-device", name: "Άλλο", storeId: "s2", tempMin: null, tempMax: null, readings: [] }] });
  assert.equal(result.findings.some((item) => item.id.includes("s2-device")), false);
});

test("όλα τα έντυπα έχουν μοναδικό ID και υπαρκτές πηγές", () => {
  assert.equal(new Set(HACCP_FORMS.map((item) => item.id)).size, HACCP_FORMS.length);
  for (const item of HACCP_FORMS) for (const source of item.sourceIds) assert.ok(HACCP_SOURCE_MAP.has(source), `${item.id}: ${source}`);
});
