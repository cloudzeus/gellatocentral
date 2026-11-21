// Συντεταγμένες από διεύθυνση, μέσω του Nominatim του OpenStreetMap. Μόνο όταν το ζητά ο χρήστης, μία διεύθυνση τη φορά
// (η δημόσια υπηρεσία επιτρέπει έως 1 αίτημα το δευτερόλεπτο και απαγορεύει μαζική χρήση).
// shortcut: δημόσιο Nominatim· αν οι αναζητήσεις γίνουν πολλές, θέλει δικό μας Nominatim ή πάροχο με σύμβαση.
type Parts = { street?: string | null; city?: string | null; postalCode?: string | null; countryCode?: string | null };
/**
 * Οι μορφές της διεύθυνσης που δοκιμάζονται, με τη σειρά. Το OpenStreetMap δεν αναγνωρίζει το είδος του δρόμου όπως το
 * γράφει η ΑΑΔΕ («ΛΕΩΦΟΡΟΣ ΚΗΦΙΣΙΑΣ 99»): πρώτα δοκιμάζεται χωρίς αυτό και χωρίς Τ.Κ., μετά όπως γράφτηκε.
 * Ποτέ μόνο η πόλη: μια πινέζα στο κέντρο της πόλης θα έμοιαζε με σωστή θέση ενώ δεν είναι.
 */
export function addressQueries(p: Parts): string[] {
  const street = (p.street ?? "").trim(), city = (p.city ?? "").trim();
  if (street.length < 2) return [];
  const bare = street.replace(/^(λεωφ(όρος|ορος|\.)?|λ\.|οδός|οδος|οδ\.)\s+/i, "");
  const out = [[bare, city], [street, p.postalCode, city]].map((x) => x.filter(Boolean).join(", "));
  return [...new Set(out)];
}

export async function geocode(parts: Parts): Promise<{ latitude: number; longitude: number; label: string } | null> {
  const queries = addressQueries(parts);
  for (const [i, q] of queries.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 1100)); // όριο της δημόσιας υπηρεσίας: ένα αίτημα το δευτερόλεπτο
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ format: "jsonv2", limit: "1", q, countrycodes: (parts.countryCode || "GR").toLowerCase(), "accept-language": "el" }).toString();
    // το Nominatim ζητά User-Agent που να λέει ποια εφαρμογή ρωτά· δεν στέλνουμε στοιχεία χρήστη ή επιχείρησης
    const res = await fetch(url, { headers: { "User-Agent": "GelatoSystem/1.0 (address lookup)" }, cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res?.ok) continue;
    const hit = ((await res.json().catch(() => [])) as { lat?: string; lon?: string; display_name?: string }[])[0];
    const latitude = Number(hit?.lat), longitude = Number(hit?.lon);
    if (hit && Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude, label: hit.display_name ?? q };
  }
  return null;
}

// ---- Προτάσεις διεύθυνσης όσο γράφει ο χρήστης ----
// Το δημόσιο Nominatim απαγορεύει την αναζήτηση «όσο πληκτρολογείς»· για αυτό εδώ ρωτάμε το Photon (photon.komoot.io),
// που είναι φτιαγμένο για αυτή τη χρήση πάνω στα ίδια δεδομένα OpenStreetMap.
// shortcut: δημόσιο Photon (δίκαιη χρήση, χωρίς εγγύηση)· με πολλούς χρήστες θέλει δικό μας Photon ή πάροχο με σύμβαση.
export type AddressSuggestion = { label: string; street: string; postalCode: string | null; city: string | null; region: string | null; countryCode: string | null; latitude: number; longitude: number;
  // Συμπλήρωση από τη γεωγραφία αναφοράς (lib/geo): ο Δήμος Καλλικράτη και η πόλη που ταιριάζουν, και η περιοχή (district του χάρτη)
  municipalityCode?: string | null; municipalityName?: string | null; cityId?: string | null; cityName?: string | null; areaName?: string | null };
type Feature = { properties?: Record<string, string | undefined>; geometry?: { coordinates?: [number, number] } };
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");
/** Η περιοχή της λίστας μας που ταιριάζει στο κείμενο του χάρτη («Αποκεντρωμένη Διοίκηση Αττικής» → «Αττική»). Μόνο αν είναι μία: αλλιώς κενό. */
export function matchRegion(text: string, regions: readonly string[]): string | null {
  const hay = fold(text).split(/[^\p{L}]+/u);
  // ίδια λέξη σε άλλη πτώση («Αττικής» ~ «Αττική»)· όχι άλλη λέξη με ίδια αρχή («Θεσσαλονίκης» δεν είναι «Θεσσαλία»)
  const same = (w: string) => hay.some((h) => h.startsWith(w.slice(0, -2)) && h.length <= w.length + 2);
  const hits = regions.filter((r) => fold(r).split(/\s+/).filter((w) => w.length > 3).every(same));
  return hits.length === 1 ? hits[0] : null;
}
/** Από την απάντηση του Photon κρατάμε μόνο όσα έχουν οδό: μια πρόταση «Αθήνα» δεν είναι διεύθυνση. */
export function parseSuggestions(json: unknown, regions: readonly string[] = []): AddressSuggestion[] {
  const out: AddressSuggestion[] = [];
  for (const f of ((json as { features?: Feature[] })?.features ?? [])) {
    const p = f.properties ?? {}, [longitude, latitude] = f.geometry?.coordinates ?? [];
    const road = p.street ?? (p.type === "street" ? p.name : undefined);
    if (!road || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const street = [road, p.housenumber].filter(Boolean).join(" ");
    const postalCode = p.postcode?.replace(/\s+/g, "") ?? null, city = p.city ?? p.town ?? p.village ?? null;
    const label = [street, [postalCode, city].filter(Boolean).join(" "), p.district && p.district !== city ? p.district : null].filter(Boolean).join(", ");
    if (out.some((x) => x.label === label)) continue;
    const district = p.district && p.district !== city ? p.district : null;
    out.push({ label, street, postalCode, city, region: matchRegion(p.state ?? "", regions), countryCode: p.countrycode?.toUpperCase() ?? null, latitude: latitude!, longitude: longitude!, ...(district ? { areaName: district } : {}) });
  }
  return out;
}
/**
 * Προτάσεις όσο γράφει ο χρήστης. Με `near`/`cityName` (η πόλη που έχει ήδη διαλέξει στη φόρμα) η αναζήτηση
 * προτιμά δρόμους εκείνης της πόλης: το όνομά της μπαίνει στο ερώτημα και τα αποτελέσματα κοντά της πρώτα —
 * αλλιώς μια οδός «Δορυλαίου» φέρνει τις ομώνυμες της Ν. Ιωνίας/Νίκαιας/Πειραιά πριν από αυτήν της Αθήνας.
 */
export async function suggestAddresses(q: string, regions: readonly string[] = [], near?: { latitude: number; longitude: number } | null, cityName?: string | null): Promise<AddressSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  // προτίμηση σε αποτελέσματα κοντά στην Ελλάδα (ή κοντά στην επιλεγμένη πόλη), χωρίς αποκλεισμό άλλων χωρών
  url.search = new URLSearchParams({ q: cityName ? `${q} ${cityName}` : q, limit: "8", lat: String(near?.latitude ?? 38.5), lon: String(near?.longitude ?? 23.8) }).toString();
  const res = await fetch(url, { headers: { "User-Agent": "GelatoSystem/1.0 (address lookup)" }, cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null);
  return res?.ok ? parseSuggestions(await res.json().catch(() => null), regions).slice(0, 5) : [];
}
