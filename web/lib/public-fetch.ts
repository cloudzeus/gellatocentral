// Server-side λήψη δημόσιων πόρων για AI εμπλουτισμό. Κάθε redirect ξαναελέγχεται:
// HTTPS, δημόσια IPs, χωρίς credentials, χρονικό όριο και φράγμα bytes (SSRF/ατελείωτες λήψεις).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { safeHttpsUrl } from "./catalog-enrichment.ts";

export class PublicFetchError extends Error {}

function publicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
}

function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  const value = address.toLowerCase().split("%")[0];
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (right.at(-1)?.includes(".")) {
    const ipv4 = right.pop()!.split(".").map(Number);
    right.push(((ipv4[0] << 8) | ipv4[1]).toString(16), ((ipv4[2] << 8) | ipv4[3]).toString(16));
  }
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.length === 8 ? groups.map((part) => Number.parseInt(part, 16)) : null;
}

/** Αποκλείει private, loopback, link-local, multicast, documentation και IPv4-mapped διευθύνσεις. */
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) return publicIpv4(address);
  const g = ipv6Groups(address);
  if (!g) return false;
  if (g.slice(0, 5).every((part) => part === 0) && (g[5] === 0 || g[5] === 0xffff)) return publicIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if (g.every((part) => part === 0) || (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;
  return true;
}

async function publicUrl(value: string) {
  const url = safeHttpsUrl(value);
  if (!url) throw new PublicFetchError("Η διεύθυνση πρέπει να είναι δημόσιο HTTPS χωρίς στοιχεία σύνδεσης");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new PublicFetchError("Η διεύθυνση δεν επιτρέπεται για λόγους ασφαλείας");
  } catch (error) {
    if (error instanceof PublicFetchError) throw error;
    throw new PublicFetchError("Δεν επιλύθηκε η διεύθυνση της εξωτερικής σελίδας");
  }
  return url;
}

export type PublicResource = { url: string; contentType: string; data: Uint8Array };

async function boundedBytes(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new PublicFetchError("Το εξωτερικό αρχείο είναι πολύ μεγάλο");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PublicFetchError("Το εξωτερικό αρχείο είναι πολύ μεγάλο");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function fetchPublicResource(input: string, options: { accept: string; maxBytes: number; timeoutMs?: number }): Promise<PublicResource> {
  let url = await publicUrl(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs ?? 12_000), headers: { Accept: options.accept, "Accept-Encoding": "identity", "User-Agent": "GelatoSystemCatalog/1.0" } });
    } catch {
      throw new PublicFetchError("Η εξωτερική σελίδα δεν απάντησε εγκαίρως");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      if (!location) throw new PublicFetchError("Η εξωτερική σελίδα επέστρεψε ατελή ανακατεύθυνση");
      url = await publicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new PublicFetchError(`Η εξωτερική σελίδα απάντησε ${response.status}`);
    }
    return { url: url.toString(), contentType: response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "", data: await boundedBytes(response, options.maxBytes) };
  }
  throw new PublicFetchError("Η εξωτερική σελίδα έχει πολλές ανακατευθύνσεις");
}
