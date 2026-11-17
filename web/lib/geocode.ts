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
