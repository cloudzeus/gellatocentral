// Γέμισμα της γεωγραφίας αναφοράς (GeoCountry/GeoRegion/GeoCity) από τα prisma/geo/*.json.
// Τα JSON φτιάχνονται με το prisma/geo/build.py (επίσημο κωδικολόγιο Καλλικράτη + GeoNames).
// Τρέχει από το prisma db seed· είναι idempotent (upsert ανά κωδικό, createMany+skipDuplicates στις πόλεις).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "../../lib/generated/prisma/client";

type RegionRow = { code: string; level: number; parentCode: string | null; nameEL: string; nameOfficial: string | null; latitude: number | null; longitude: number | null; path: string | null };
type CityRow = { id: string; name: string; nameEn: string | null; municipalityCode: string; latitude: number; longitude: number; population: number; featureCode: string };
type CountryRow = { code: string; iso3: string | null; nameEN: string; isEu: boolean };

const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(__dirname, file), "utf8")) as T;

/** Ονόματα χωρών στα ελληνικά από το ICU του Node· όπου λείπει μετάφραση μένει το αγγλικό. */
const greekName = (() => {
  const dn = new Intl.DisplayNames(["el"], { type: "region" });
  return (code: string, fallback: string) => {
    const el = dn.of(code);
    return el && el !== code ? el : fallback;
  };
})();

export async function seedGeo(db: PrismaClient) {
  const countries = read<CountryRow[]>("countries.json");
  for (const c of countries) {
    const data = { iso3: c.iso3, nameEL: greekName(c.code, c.nameEN), nameEN: c.nameEN, isEu: c.isEu };
    await db.geoCountry.upsert({ where: { code: c.code }, update: data, create: { code: c.code, ...data } });
  }

  // Γονείς πριν τα παιδιά: τα JSON είναι ταξινομημένα ανά επίπεδο (3 → 4 → 5)
  const regions = read<RegionRow[]>("regions.json");
  for (const r of regions) {
    const data = { level: r.level, parentCode: r.parentCode, nameEL: r.nameEL, nameOfficial: r.nameOfficial, path: r.path, latitude: r.latitude, longitude: r.longitude };
    await db.geoRegion.upsert({ where: { code: r.code }, update: data, create: { code: r.code, ...data } });
  }

  const cities = read<CityRow[]>("cities.json");
  let added = 0;
  for (let i = 0; i < cities.length; i += 4000) {
    const res = await db.geoCity.createMany({
      data: cities.slice(i, i + 4000).map((c) => ({ id: c.id, name: c.name, nameEn: c.nameEn, municipalityCode: c.municipalityCode, latitude: c.latitude, longitude: c.longitude, population: c.population, source: "geonames" })),
      skipDuplicates: true,
    });
    added += res.count;
  }
  return { countries: countries.length, regions: regions.length, cities, added };
}
