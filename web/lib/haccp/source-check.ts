import { db } from "@/lib/db";
import { fetchPublicResource } from "@/lib/public-fetch";
import { sourceFingerprint } from "./source-fingerprint.ts";
import { nextSourceStatus } from "./source-status.ts";
import { HACCP_SOURCES } from "./sources.ts";

export { nextSourceStatus } from "./source-status.ts";
export type { SourceStatus } from "./source-status.ts";

export async function checkOfficialSources(now = new Date()) {
  const previous = await db.haccpSourceCheck.findMany();
  const old = new Map(previous.map((item) => [item.sourceId, item]));
  const results = [];
  // Διαδοχικά: δεν δημιουργούμε αιφνίδιο φόρτο στους δημόσιους φορείς.
  for (const source of HACCP_SOURCES) {
    try {
      const resource = await fetchPublicResource(source.url, { accept: "text/html,application/pdf;q=0.9,*/*;q=0.1", maxBytes: 12_000_000, timeoutMs: 15_000 });
      const fingerprint = sourceFingerprint(resource.contentType, resource.data);
      const status = nextSourceStatus(old.get(source.id) ?? null, { fingerprint, finalUrl: resource.url, url: source.url });
      const data = { url: source.url, finalUrl: resource.url, fingerprint, status, httpStatus: 200, message: status === "OK" ? "Αμετάβλητο από τον προηγούμενο έλεγχο" : "Απαιτείται ανθρώπινη αναθεώρηση πριν αλλάξει ο οδηγός", checkedAt: now, ...(status === "CHANGED" ? { changedAt: now } : {}) };
      await db.haccpSourceCheck.upsert({ where: { sourceId: source.id }, create: { sourceId: source.id, ...data }, update: data });
      results.push({ sourceId: source.id, status });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Αδυναμία ελέγχου";
      await db.haccpSourceCheck.upsert({ where: { sourceId: source.id }, create: { sourceId: source.id, url: source.url, status: "ERROR", message, checkedAt: now }, update: { status: "ERROR", message, checkedAt: now } });
      results.push({ sourceId: source.id, status: "ERROR" as const });
    }
  }
  return results;
}
