// Bunny Edge Storage (https://bunny.net/docs/reference/storage-api). Ο server μιλά στο Bunny με τον κωδικό της ζώνης·
// ο browser δεν τον βλέπει ποτέ. Τα δημόσια αρχεία σερβίρονται από το pull zone.
// Ζώνη, περιοχή και διεύθυνση CDN ορίζονται στις Ρυθμίσεις της πλατφόρμας (ή στο περιβάλλον, π.χ. για scripts)·
// ο κωδικός μόνο στο περιβάλλον: BUNNY_STORAGE_KEY.
import { cache } from "react";
import { db } from "../db";

export const REGIONS: [value: string, text: string][] = [["", "Falkenstein, Γερμανία (προεπιλογή)"], ["uk", "Λονδίνο"], ["se", "Στοκχόλμη"], ["ny", "Νέα Υόρκη"], ["la", "Λος Άντζελες"], ["sg", "Σιγκαπούρη"], ["syd", "Σίδνεϊ"], ["br", "Σάο Πάολο"], ["jh", "Γιοχάνεσμπουργκ"]];
const env = (k: string) => process.env[k]?.trim() || "";

/** Μία ανάγνωση ανά αίτημα. */
export const storageConfig = cache(async () => {
  const s = await db.platformSettings.findUnique({ where: { id: 1 }, select: { bunnyZone: true, bunnyRegion: true, bunnyCdnUrl: true } });
  const zone = s?.bunnyZone || env("BUNNY_STORAGE_ZONE"), key = env("BUNNY_STORAGE_KEY");
  return { zone, region: s?.bunnyRegion || env("BUNNY_STORAGE_REGION"), cdn: (s?.bunnyCdnUrl || env("BUNNY_CDN_URL")).replace(/\/$/, ""), hasKey: !!key, ready: !!(zone && key) };
});
export const storageConfigured = async () => (await storageConfig()).ready;

const encode = (path: string) => path.split("/").map(encodeURIComponent).join("/");
/** π.χ. https://storage.bunnycdn.com/<ζώνη>/orgs/abc/photo/x.jpg (ή με περιοχή: https://uk.storage.bunnycdn.com/…) */
async function target(path: string) {
  const c = await storageConfig();
  if (!c.ready) throw new Error("Δεν έχει οριστεί αποθήκευση αρχείων (ζώνη στις Ρυθμίσεις, BUNNY_STORAGE_KEY στον server)");
  // BUNNY_STORAGE_ENDPOINT: μόνο για δοκιμές απέναντι σε τοπικό server
  const base = env("BUNNY_STORAGE_ENDPOINT") || `https://${c.region ? `${c.region}.` : ""}storage.bunnycdn.com`;
  return `${base.replace(/\/$/, "")}/${c.zone}/${encode(path)}`;
}
const auth = () => ({ AccessKey: env("BUNNY_STORAGE_KEY") });
async function expectOk(res: Response, what: string) {
  if (!res.ok) throw new Error(`Bunny: ${what} απέτυχε (${res.status})`);
  return res;
}

export const put = async (path: string, body: Uint8Array, contentType: string) =>
  expectOk(await fetch(await target(path), { method: "PUT", headers: { ...auth(), "Content-Type": contentType }, body: body as BodyInit, cache: "no-store" }), "αποθήκευση");
export const remove = async (path: string) => {
  const res = await fetch(await target(path), { method: "DELETE", headers: auth(), cache: "no-store" });
  if (res.status !== 404) await expectOk(res, "διαγραφή"); // ήδη σβησμένο = εντάξει
};
export const download = async (path: string) => expectOk(await fetch(await target(path), { headers: auth(), cache: "no-store" }), "λήψη");
/** Διεύθυνση δημόσιου αρχείου στο CDN, ή null αν δεν έχει οριστεί pull zone. */
export const cdnUrl = async (path: string) => { const { cdn } = await storageConfig(); return cdn ? `${cdn}/${encode(path)}` : null; };

/** Δοκιμή σύνδεσης: ζητά τη λίστα του ριζικού φακέλου της ζώνης. */
export async function ping(): Promise<{ ok: boolean; text: string }> {
  const c = await storageConfig();
  if (!c.zone) return { ok: false, text: "Δεν έχει οριστεί το όνομα της ζώνης" };
  if (!c.hasKey) return { ok: false, text: "Λείπει το BUNNY_STORAGE_KEY από το .env του server" };
  try {
    const res = await fetch(await target(""), { headers: { ...auth(), Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, text: `Το Bunny απάντησε: η ζώνη «${c.zone}» είναι προσβάσιμη` };
    return { ok: false, text: res.status === 401 ? "Το Bunny απέρριψε τον κωδικό (401). Έλεγξε το BUNNY_STORAGE_KEY και την περιοχή" : res.status === 404 ? "Η ζώνη δεν βρέθηκε (404). Έλεγξε το όνομα και την περιοχή" : `Το Bunny απάντησε ${res.status}` };
  } catch {
    return { ok: false, text: "Δεν υπήρξε απάντηση από το Bunny. Έλεγξε τη σύνδεση του server" };
  }
}
