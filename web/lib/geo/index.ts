// Γεωγραφία αναφοράς (GeoCountry/GeoRegion/GeoCity/GeoArea) — το μοναδικό σημείο που τα διαβάζει η εφαρμογή.
// Κοινά δεδομένα για όλους τους πελάτες (χωρίς orgId). Οι φόρμες τα τραβούν από τα /api/geo/* routes,
// οι server actions επιβεβαιώνουν τους κωδικούς με validGeoIds πριν γράψουν.
import { cache } from "react";
import { db } from "@/lib/db";
import {
  buildBreadcrumb,
  nameMatchCandidate,
  nearestNode,
  normalizeGreek,
  walkGeoChain,
  type GeoBreadcrumb,
  type GeoChainNode,
} from "./pure";

export * from "./pure";

// ---- Χώρες ----
/** Ενεργές χώρες για τα dropdown: πρώτα η Ελλάδα, μετά αλφαβητικά στα ελληνικά. */
export const geoCountries = cache(async (): Promise<[string, string][]> => {
  const rows = await db.geoCountry.findMany({ where: { active: true }, orderBy: { nameEL: "asc" } });
  rows.sort((a, b) => (a.code === "GR" ? -1 : b.code === "GR" ? 1 : 0));
  return rows.map((c): [string, string] => [c.code, c.nameEL]);
});

// ---- Δέντρο Καλλικράτη ----
export type GeoRegionNode = { code: string; nameEL: string; level: number; parentCode: string | null };

/** Τα παιδιά ενός κόμβου· χωρίς parentCode οι 13 Περιφέρειες. */
export function geoRegionChildren(parentCode?: string | null): Promise<GeoRegionNode[]> {
  return db.geoRegion.findMany({
    where: { active: true, ...(parentCode ? { parentCode } : { level: 3 }) },
    orderBy: { nameEL: "asc" },
    select: { code: true, nameEL: true, level: true, parentCode: true },
  });
}

/** Αναζήτηση σε νομούς και δήμους με κανονικοποίηση (άνευ τόνων/πτώσης). */
export const searchGeoRegions = cache(async (q: string, level?: 4 | 5): Promise<GeoRegionNode[]> => {
  const all = await db.geoRegion.findMany({
    where: { active: true, level: level ?? { in: [4, 5] } },
    select: { code: true, nameEL: true, nameOfficial: true, level: true, parentCode: true },
  });
  const nq = normalizeGreek(q);
  if (nq.length < 2) return [];
  return all
    .filter((r) => normalizeGreek(r.nameEL).includes(nq) || (r.nameOfficial && normalizeGreek(r.nameOfficial).includes(nq)))
    .slice(0, 15)
    .map((r): GeoRegionNode => ({ code: r.code, nameEL: r.nameEL, level: r.level, parentCode: r.parentCode }));
});

/** Η αλυσίδα Περιφέρεια → Νομός → Δήμος ενός κόμβου. */
export async function geoBreadcrumb(code: string): Promise<GeoBreadcrumb> {
  const nodeMap = new Map<string, GeoChainNode>();
  let current: string | null = code;
  for (let i = 0; i < 8 && current; i++) {
    const node: GeoChainNode | null = await db.geoRegion.findUnique({
      where: { code: current },
      select: { code: true, nameEL: true, level: true, parentCode: true },
    });
    if (!node) break;
    nodeMap.set(node.code, node);
    current = node.parentCode;
  }
  return buildBreadcrumb(walkGeoChain(code, nodeMap));
}

// ---- Πόλεις και περιοχές ----
export type GeoCityHit = { id: string; name: string; municipality: string | null; municipalityCode: string | null; parents: string | null; latitude: number | null; longitude: number | null; population: number };

/** Πόλεις ενός δήμου (ή συνολική αναζήτηση όταν λείπει ο δήμος), με τις πολυάνθρωπες πρώτες.
 *  Το `parents` είναι η πατρική αλυσίδα «Δήμος › Νομός»: στην ελεύθερη αναζήτηση τα ομώνυμα
 *  («Γλυφάδα» ×6) εμφανίζονται δενδροειδώς και ξεχωρίζουν. */
export async function geoCities(opts: { municipalityCode?: string | null; q?: string; take?: number }): Promise<GeoCityHit[]> {
  const q = opts.q?.trim();
  const rows = await db.geoCity.findMany({
    where: {
      active: true,
      countryCode: "GR",
      ...(opts.municipalityCode ? { municipalityCode: opts.municipalityCode } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ population: "desc" }, { name: "asc" }],
    take: opts.take ?? 25,
    select: { id: true, name: true, municipalityCode: true, latitude: true, longitude: true, population: true, municipality: { select: { nameEL: true, parent: { select: { nameEL: true } } } } },
  });
  return rows.map(({ municipality, ...r }) => {
    const chain = [municipality?.parent?.nameEL ?? null, municipality?.nameEL ?? null].filter(Boolean);
    return { ...r, municipality: municipality?.nameEL ?? null, parents: chain.length ? chain.join(" › ") : null };
  });
}

export type GeoAreaHit = { id: string; name: string; postalCode: string | null };

export function geoAreas(cityId: string, q?: string): Promise<GeoAreaHit[]> {
  return db.geoArea.findMany({
    where: { cityId, ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: 25,
    select: { id: true, name: true, postalCode: true },
  });
}

// ---- Αντιστοίχιση ελεύθερου κειμένου με το δέντρο ----
export type GeoMatch = { regionCode: string; breadcrumb: GeoBreadcrumb; confidence: "name" | "geo" };

/**
 * Από ελεύθερο κείμενο (πόλη/περιοχή όπως γράφτηκε) στον Δήμο Καλλικράτη που ταιριάζει.
 * Σειρά: ακριβές όνομα δήμου → όνομα πόλης (τον δήμο της) → κοντινότερος δήμος στις συντεταγμένες.
 */
export async function matchMunicipality(input: { city?: string | null; region?: string | null; latitude?: number | null; longitude?: number | null }): Promise<GeoMatch | null> {
  const municipalities = await db.geoRegion.findMany({
    where: { active: true, level: 5 },
    select: { code: true, nameEL: true, nameOfficial: true, latitude: true, longitude: true },
  });
  // 1) το κείμενο είναι όνομα δήμου ή νομού
  for (const q of [input.city, input.region]) {
    if (!q) continue;
    const code = nameMatchCandidate(q, municipalities) ?? nameMatchCandidate(q, await level4());
    if (code) return { regionCode: code, breadcrumb: await geoBreadcrumb(code), confidence: "name" };
  }
  // 2) το κείμενο είναι πόλη/οικισμός: ο δήμος στον οποίο ανήκει
  if (input.city) {
    const cities = await db.geoCity.findMany({
      where: { active: true, countryCode: "GR", municipalityCode: { not: null } },
      select: { name: true, municipalityCode: true, population: true },
    });
    const nq = normalizeGreek(input.city);
    if (nq.length >= 2) {
      const hit = cities.filter((c) => normalizeGreek(c.name) === nq).sort((a, b) => b.population - a.population)[0];
      if (hit?.municipalityCode) return { regionCode: hit.municipalityCode, breadcrumb: await geoBreadcrumb(hit.municipalityCode), confidence: "name" };
    }
  }
  // 3) κοντινότερος δήμος από συντεταγμένες
  if (input.latitude != null && input.longitude != null) {
    const code = nearestNode({ lat: input.latitude, lng: input.longitude }, municipalities);
    if (code) return { regionCode: code, breadcrumb: await geoBreadcrumb(code), confidence: "geo" };
  }
  return null;
}

const level4 = cache(() =>
  db.geoRegion.findMany({ where: { active: true, level: 4 }, select: { code: true, nameEL: true, nameOfficial: true } }),
);

// ---- Επιβεβαίωση τιμών φόρμας πριν την αποθήκευση ----
export type GeoIds = { regionCode: string | null; cityId: string | null; areaId: string | null };

/**
 * Καθαρίζει τους κωδικούς που ήρθαν από τη φόρμα: ό,τι δεν υπάρχει ή δεν είναι συνεπές
 * (περιοχή άλλης πόλης, πόλη άλλου δήμου) απορρίπτεται. Η περιοχή συνεπάγεται την πόλη,
 * η πόλη τον δήμο. Χωρίς κωδικούς, best-effort ταίριασμα από το κείμενο της πόλης.
 */
export async function validGeoIds(raw: { regionCode?: unknown; cityId?: unknown; areaId?: unknown; cityText?: string | null; regionText?: string | null }): Promise<GeoIds> {
  let regionCode = typeof raw.regionCode === "string" && raw.regionCode ? raw.regionCode : null;
  let cityId = typeof raw.cityId === "string" && raw.cityId ? raw.cityId : null;
  let areaId = typeof raw.areaId === "string" && raw.areaId ? raw.areaId : null;

  if (areaId) {
    const area = await db.geoArea.findUnique({ where: { id: areaId }, select: { cityId: true } });
    if (area) cityId = area.cityId;
    else areaId = null;
  }
  if (cityId) {
    const city = await db.geoCity.findFirst({ where: { id: cityId, active: true }, select: { municipalityCode: true } });
    // η πόλη «κερδίζει» τον δήμο της φόρμας: αν διαφέρουν, η αλυσίδα ακολουθεί την πόλη
    if (city) regionCode = city.municipalityCode ?? regionCode;
    else {
      cityId = null;
      areaId = null;
    }
  }
  if (regionCode && !(await db.geoRegion.findFirst({ where: { code: regionCode, active: true }, select: { code: true } }))) regionCode = null;

  // Χωρίς τίποτα από τη φόρμα: μάντεψε τον δήμο από το κείμενο (παλιές φόρμες, εισαγωγές)
  if (!regionCode && (raw.cityText || raw.regionText)) {
    const match = await matchMunicipality({ city: raw.cityText, region: raw.regionText });
    regionCode = match?.regionCode ?? null;
  }
  return { regionCode, cityId, areaId };
}

/**
 * Νέα περιοχή από geocoding ή από τον χρήστη: αν δεν υπάρχει στην πόλη, μπαίνει (κοινή για όλους).
 * Επιστρέφει το id της ή null όταν λείπει η πόλη ή το όνομα.
 */
export async function ensureGeoArea(cityId: string | null, name: string | null, extra?: { postalCode?: string | null; latitude?: number | null; longitude?: number | null; source?: string }): Promise<string | null> {
  const clean = name?.trim().slice(0, 80);
  if (!cityId || !clean) return null;
  const found = await db.geoArea.findFirst({ where: { cityId, name: { equals: clean, mode: "insensitive" } }, select: { id: true } });
  if (found) return found.id;
  const created = await db.geoArea.create({
    data: { cityId, name: clean, postalCode: extra?.postalCode ?? null, latitude: extra?.latitude ?? null, longitude: extra?.longitude ?? null, source: extra?.source ?? "manual" },
    select: { id: true },
  });
  return created.id;
}

// ---- Εμπλουτισμός προτάσεων διεύθυνσης με τη γεωγραφία αναφοράς ----
type Suggestion = { city: string | null; latitude: number; longitude: number };

/**
 * Σε κάθε πρόταση του χάρτη βρίσκει τον Δήμο Καλλικράτη (όνομα πόλης ή κοντινότερος στις
 * συντεταγμένες, έως 25 km) και την πόλη της κοινής λίστας, ώστε η φόρμα να γεμίζει και τα
 * dropdown Περιφέρεια → Νομός → Δήμος → Πόλη με μία επιλογή.
 */
export async function enrichSuggestions<T extends Suggestion>(suggestions: T[]): Promise<(T & { municipalityCode: string | null; municipalityName: string | null; cityId: string | null; cityName: string | null })[]> {
  if (!suggestions.length) return [];
  const municipalities = await db.geoRegion.findMany({
    where: { active: true, level: 5 },
    select: { code: true, nameEL: true, nameOfficial: true, latitude: true, longitude: true },
  });
  return Promise.all(
    suggestions.map(async (s) => {
      const code = (s.city ? nameMatchCandidate(s.city, municipalities) : null) ?? nearestNode({ lat: s.latitude, lng: s.longitude }, municipalities, 25);
      if (!code) return { ...s, municipalityCode: null, municipalityName: null, cityId: null, cityName: null };
      const municipalityName = municipalities.find((m) => m.code === code)?.nameEL ?? null;
      let cityId: string | null = null;
      let cityName: string | null = null;
      if (s.city) {
        const nq = normalizeGreek(s.city);
        const hit = (
          await db.geoCity.findMany({ where: { municipalityCode: code, active: true }, select: { id: true, name: true, population: true } })
        )
          .filter((c) => normalizeGreek(c.name) === nq)
          .sort((a, b) => b.population - a.population)[0];
        if (hit) {
          cityId = hit.id;
          cityName = hit.name;
        }
      }
      return { ...s, municipalityCode: code, municipalityName, cityId, cityName };
    }),
  );
}
