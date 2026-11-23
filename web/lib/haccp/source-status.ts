export type SourceStatus = "OK" | "CHANGED" | "REVIEW" | "ERROR";

export function nextSourceStatus(
  previous: { fingerprint: string | null; finalUrl: string | null; url: string } | null,
  current: { fingerprint: string; finalUrl: string; url: string },
): SourceStatus {
  if (!previous?.fingerprint) return "REVIEW";
  if (previous.url !== current.url || previous.finalUrl !== current.finalUrl || previous.fingerprint !== current.fingerprint) return "CHANGED";
  return "OK";
}
