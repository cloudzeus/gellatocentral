// Yeastar P-Series OpenAPI: υπογραφή webhook και ανάλυση γεγονότων κλήσης (docs/analysis/OFF-PREMISE-ORDERS.md).
// 30011 Call State Changed: έρχεται σε κάθε αλλαγή της κλήσης· 30012 Call End: η εγγραφή της κλήσης στο τέλος.
import { createHmac, timingSafeEqual } from "node:crypto";

/** X-Signature = Base64(HMAC-SHA256(ακατέργαστο σώμα, secret)). Σύγκριση σταθερού χρόνου. */
export function verifySignature(raw: string, secret: string, signature: string | null): boolean {
  if (!signature) return false;
  const want = createHmac("sha256", secret).update(raw, "utf8").digest();
  const got = Buffer.from(signature.trim(), "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

export type CallEvent =
  | { kind: "ring"; callId: string; from: string; extension: string | null }
  | { kind: "answered"; callId: string; extension: string | null }
  | { kind: "ended"; callId: string };

type Member = { inbound?: { from?: string; member_status?: string }; extension?: { number?: string; member_status?: string } };

/**
 * Από το σώμα του γεγονότος σε ό,τι μας ενδιαφέρει. null = άλλο γεγονός ή κλήση χωρίς εξωτερικό καλούντα.
 * shortcut: το σχήμα βγαίνει από τα docs (WebSocket: msg ως κείμενο JSON)· επιβεβαίωση σε πραγματικό PBX.
 */
export function parseEvent(body: unknown): CallEvent | null {
  if (!body || typeof body !== "object") return null;
  const { type, msg: rawMsg } = body as { type?: number | string; msg?: unknown };
  let msg = rawMsg;
  if (typeof msg === "string") try { msg = JSON.parse(msg); } catch { return null; }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { call_id?: string | number; members?: Member[] };
  const callId = m.call_id == null ? "" : String(m.call_id);
  if (!callId) return null;
  if (Number(type) === 30012) return { kind: "ended", callId };
  if (Number(type) !== 30011) return null;
  const members = Array.isArray(m.members) ? m.members : [];
  const inbound = members.find((x) => x.inbound)?.inbound;
  if (!inbound?.from) return null; // εσωτερική ή εξερχόμενη κλήση
  const ext = members.find((x) => x.extension)?.extension;
  const extension = ext?.number ? String(ext.number) : null;
  const status = [inbound.member_status, ext?.member_status].map((s) => String(s ?? "").toUpperCase());
  if (status.includes("ANSWERED")) return { kind: "answered", callId, extension };
  if (status.includes("BYE")) return { kind: "ended", callId };
  if (status.some((s) => s === "ALERT" || s === "RING" || s === "RINGING")) return { kind: "ring", callId, from: String(inbound.from), extension };
  return null;
}
