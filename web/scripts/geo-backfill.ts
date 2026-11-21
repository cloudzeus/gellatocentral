// Μαζική σύνδεση των υπαρχόντων εγγραφών με τη γεωγραφία αναφοράς (Geo*):
// σε κάθε Party/PartyAddress/Store χωρίς regionCode βρίσκουμε τον Δήμο Καλλικράτη από το κείμενο
// (πόλη ή περιοχή/νομός όπως γράφτηκε) ή από τις συντεταγμένες, και μετά την πόλη από την κοινή λίστα.
// Όποια εγγραφή έχει ήδη δήμο αλλά όχι πόλη, ξαναδοκιμάζει μόνο την πόλη (χρήσιμο μετά από νέες πόλεις στο seed).
// Τα πεδία-κείμενο (city/region) δεν πειράζονται: μένουν ως «φωτογραφία» για εκτυπώσεις και αναζήτηση.
// Idempotent: ξανατρέχοντάς το πιάνει μόνο ό,τι έμεινε χωρίς κωδικό.
// Χρήση: npx tsx scripts/geo-backfill.ts
import "dotenv/config";
import { db } from "../lib/db";
import { matchMunicipality } from "../lib/geo";
import { normalizeGreek } from "../lib/geo/pure";

type Row = { id: string; regionCode: string | null; cityId: string | null; address?: string | null; street?: string | null; city: string | null; region: string | null; latitude: number | null; longitude: number | null };

/** Υποψήφια πόλη: το πεδίο city, ή το τελευταίο κομμάτι της διεύθυνσης («Ακτή Μουτσοπούλου 1, Πειραιάς» → «Πειραιάς»). */
const cityText = (row: Row) => {
  const street = row.address ?? row.street;
  return row.city ?? (street?.includes(",") ? street.split(",").pop()!.trim() : null);
};

/** Η πόλη του δήμου από την κοινή λίστα: ακριβές όνομα (άνευ τόνων/πτώσης), η πολυάνθρωπη αν υπάρχουν όμωνυμες. */
async function matchCity(municipalityCode: string, text: string | null): Promise<string | null> {
  const nq = normalizeGreek(text ?? "");
  if (nq.length < 2) return null;
  const cities = await db.geoCity.findMany({ where: { municipalityCode, active: true }, select: { id: true, name: true, population: true } });
  const hit = cities.filter((c) => normalizeGreek(c.name) === nq).sort((a, b) => b.population - a.population)[0];
  return hit?.id ?? null;
}

async function backfill(label: string, rows: Row[], update: (row: Row, data: { regionCode: string; cityId: string | null }) => Promise<unknown>) {
  let linked = 0, withCity = 0;
  const misses: string[] = [];
  for (const row of rows) {
    const city = cityText(row);
    let regionCode = row.regionCode;
    if (!regionCode) {
      const match = await matchMunicipality({ city, region: row.region, latitude: row.latitude, longitude: row.longitude });
      if (!match) {
        if (city || row.region) misses.push([city, row.region].filter(Boolean).join(" · "));
        continue;
      }
      regionCode = match.regionCode;
      linked++;
    }
    const cityId = row.cityId ?? (await matchCity(regionCode, city));
    if (cityId && !row.cityId) withCity++;
    if (regionCode !== row.regionCode || cityId !== row.cityId) await update(row, { regionCode, cityId });
  }
  console.log(`${label}: ${rows.length} εγγραφές → ${linked} συνδέθηκαν με δήμο Καλλικράτη, ${withCity} βρήκαν και πόλη της κοινής λίστας`);
  if (misses.length) console.log(`  χωρίς ταίριασμα: ${[...new Set(misses)].slice(0, 12).join(" | ")}${misses.length > 12 ? ` … και ${misses.length - 12} ακόμα` : ""}`);
}

async function main() {
  // μόνο ελληνικές διευθύνσεις που λείπει δήμος ή πόλη· τα καταστήματα είναι εξ ορισμού εντός Ελλάδος
  const pending = { OR: [{ regionCode: null }, { cityId: null }] };
  await backfill(
    "Συναλλασσόμενοι (έδρα)",
    await db.party.findMany({ where: { ...pending, countryCode: "GR" }, select: { id: true, regionCode: true, cityId: true, address: true, city: true, region: true, latitude: true, longitude: true } }),
    (row, data) => db.party.update({ where: { id: row.id }, data }),
  );
  await backfill(
    "Διευθύνσεις/υποκαταστήματα",
    await db.partyAddress.findMany({ where: { ...pending, countryCode: "GR" }, select: { id: true, regionCode: true, cityId: true, street: true, city: true, region: true, latitude: true, longitude: true } }),
    (row, data) => db.partyAddress.update({ where: { id: row.id }, data }),
  );
  await backfill(
    "Καταστήματα",
    await db.store.findMany({ where: pending, select: { id: true, regionCode: true, cityId: true, address: true, city: true, region: true, latitude: true, longitude: true } }),
    (row, data) => db.store.update({ where: { id: row.id }, data }),
  );
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
