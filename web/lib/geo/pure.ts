// Γεωγραφία — καθαρές συναρτήσεις χωρίς βάση/δίκτυο (ελέγχονται από geo.test.ts).
// Η λογική αντιστοίχισης ονομάτων ακολουθεί το damask (lib/registries/regions-match-pure.ts):
// κανονικοποίηση ελληνικών, αφαίρεση διοικητικών προθεμάτων, κοντινότερος κόμβος με haversine.

export const MIN_QUERY_LEN = 4; // κάτω από 4 γράμματα το ταίριασμα με όνομα δίνει ψευδώς θετικά
export const STEM_LEN = 5; // κοινό πρόθεμα για αντιστοίχιση ουσιαστικού/γενικής («ΔΟΞΑΤΟ»~«ΔΟΞΑΤΟΥ»)
export const GEO_CAP_KM = 50; // πιο μακριά από κάθε κέντρο δήμου: το γεωγραφικό ταίριασμα απορρίπτεται

// Διοικητικά προθέματα που αφαιρούνται από ονόματα Καλλικράτη και από κείμενο χρήστη/ΑΑΔΕ
const ADMIN_PREFIX = /^\s*(ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ|ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑΣ|ΠΕΡΙΦΕΡΕΙΑ|ΔΗΜΟΣ|ΝΟΜΟΣ|Π\.?Ε\.?|Δ\.)\s+/;

/** Κεφαλαία, χωρίς τόνους, ς→σ, μονά κενά. «Δήμος Δράμας» → «ΔΗΜΟΣ ΔΡΑΜΑΣ». */
export function normalizeGreek(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // συνδυαστικοί τόνοι
    .replace(/ς/g, "σ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Όνομα χωρίς διοικητικό πρόθεμα και παρενθέσεις, κανονικοποιημένο. */
export function coreName(nameEL: string): string {
  const noParen = nameEL.replace(/\(.*?\)/g, "").trim();
  return normalizeGreek(noParen).replace(ADMIN_PREFIX, "").trim();
}

/** Ο καλύτερος κόμβος για ελεύθερο κείμενο («Πεντέλη», «ΔΟΞΑΤΟΥ»), ή null όταν τίποτα δεν ταιριάζει πειστικά. */
export function nameMatchCandidate(query: string, nodes: { code: string; nameEL: string; nameOfficial?: string | null }[]): string | null {
  const q = normalizeGreek(query);
  if (q.length < MIN_QUERY_LEN) return null;
  const cores = nodes.map((n) => ({ code: n.code, core: coreName(n.nameEL), official: n.nameOfficial ? coreName(n.nameOfficial) : null }));
  // 1) ακριβές ταίριασμα (εμφανιστικό ή επίσημο όνομα)
  for (const n of cores) if (n.core === q || n.official === q) return n.code;
  // 2) περιεκτικότητα προς τις δύο κατευθύνσεις («ΑΘΗΝΑ» ⊂ «ΑΘΗΝΑΙΩΝ»)
  for (const n of cores) if (n.core.includes(q) || q.includes(n.core) || (n.official && (n.official.includes(q) || q.includes(n.official)))) return n.code;
  // 3) κοινό πρόθεμα STEM_LEN χαρακτήρων (πτώσεις)
  if (q.length >= STEM_LEN) {
    const stem = q.slice(0, STEM_LEN);
    for (const n of cores) if (n.core.startsWith(stem) || n.official?.startsWith(stem)) return n.code;
  }
  return null;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ο κοντινότερος κόμβος στο σημείο, έως capKm· αλλιώς null. */
export function nearestNode(
  point: { lat: number; lng: number },
  nodes: { code: string; latitude: number | null; longitude: number | null }[],
  capKm = GEO_CAP_KM,
): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const n of nodes) {
    if (n.latitude == null || n.longitude == null) continue;
    const km = haversineKm(point, { lat: n.latitude, lng: n.longitude });
    if (km < bestKm) {
      bestKm = km;
      best = n.code;
    }
  }
  return bestKm <= capKm ? best : null;
}

export type GeoChainNode = { code: string; nameEL: string; level: number; parentCode: string | null };

/** Η αλυσίδα ρίζα→κόμβος από ένα node map (το γέμισμα του map είναι δουλειά του server μέρους). */
export function walkGeoChain(code: string, nodeMap: Map<string, GeoChainNode>): GeoChainNode[] {
  const chain: GeoChainNode[] = [];
  let current: string | null = code;
  for (let i = 0; i < 8 && current; i++) {
    const node = nodeMap.get(current);
    if (!node) break;
    chain.unshift(node);
    current = node.parentCode;
  }
  return chain;
}

export type GeoBreadcrumb = {
  region: GeoChainNode | null; // level 3: Περιφέρεια
  unit: GeoChainNode | null; // level 4: Περιφερειακή Ενότητα / νομός
  municipality: GeoChainNode | null; // level 5: Δήμος
};

export function buildBreadcrumb(chain: GeoChainNode[]): GeoBreadcrumb {
  const at = (level: number) => chain.find((n) => n.level === level) ?? null;
  return { region: at(3), unit: at(4), municipality: at(5) };
}

/** Σύντομο όνομα περιφέρειας για το πεδίο-κείμενο region: «Περιφέρεια Αττικής» → «Αττική». */
export function shortRegionName(nameEL: string): string {
  return nameEL.replace(/^Περιφέρεια\s+/, "").trim();
}

/** Σύντομο όνομα δήμου/νομού: «Δήμος Πεντέλης» → «Πεντέλη», «Νομός Δράμας» → «Δράμα». Σε γενική μένει ως έχει. */
export function shortUnitName(nameEL: string): string {
  return nameEL.replace(/^(Νομός|Π\.Ε\.|Δήμος)\s+/, "").trim();
}
