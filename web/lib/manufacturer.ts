// Ενιαίο όνομα κατασκευαστή: κεφαλαία χωρίς τόνους. Για τα διπλότυπα χρησιμοποιούμε
// και κοινό λατινικό κλειδί, ώστε να συναντιώνται ελληνική γραφή, μεταγραφή και greeklish.

/** Εμφάνιση/αποθήκευση: διατηρεί το αλφάβητο και τη στίξη, αφαιρεί τόνους και διακριτικά. */
export function normalizeManufacturerName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "SS")
    .replace(/[Ææ]/g, "AE")
    .replace(/[Œœ]/g, "OE")
    .replace(/[Øø]/g, "O")
    .replace(/[Łł]/g, "L")
    .replace(/[Đð]/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const GREEK_CHAR: Record<string, string> = {
  Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "TH",
  Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N", Ξ: "X", Ο: "O", Π: "P",
  Ρ: "R", Σ: "S", Τ: "T", Υ: "I", Φ: "F", Χ: "X", Ψ: "PS", Ω: "O",
};

/**
 * Πιθανά κλειδιά σύγκρισης. Τα H/W έχουν πάνω από μία συνήθη χρήση στο greeklish,
 * οπότε επιστρέφονται εναλλακτικές· η τελική συγχώνευση χρειάζεται πάντα επιβεβαίωση.
 */
export function manufacturerMatchKeys(input: string): string[] {
  let value = normalizeManufacturerName(input)
    .replace(/ΜΠ/g, "B")
    .replace(/ΝΤ/g, "D")
    .replace(/ΓΚ|ΓΓ/g, "G")
    .replace(/ΤΣ/g, "TS")
    .replace(/ΤΖ/g, "TZ")
    .replace(/ΟΥ/g, "OU")
    .replace(/ΕΙ|ΟΙ|ΥΙ/g, "I")
    .replace(/ΑΙ/g, "E")
    .replace(/ΕΥ/g, "EV")
    .replace(/ΑΥ/g, "AV")
    .replace(/[Α-Ω]/g, (letter) => GREEK_CHAR[letter] ?? letter);

  value = value
    .replace(/CH/g, "X")
    .replace(/PH/g, "F")
    .replace(/C|Q/g, "K")
    .replace(/MP|MB/g, "B")
    .replace(/NT|ND/g, "D")
    .replace(/GK|GG|NG/g, "G")
    .replace(/OU|OY/g, "U")
    .replace(/EI|OI/g, "I")
    .replace(/AI/g, "E")
    .replace(/EY/g, "EV")
    .replace(/AY/g, "AV")
    .replace(/EF/g, "EV")
    .replace(/AF/g, "AV")
    .replace(/Y/g, "I");

  let variants = [""];
  for (const letter of value) {
    const alternatives = letter === "H" ? ["H", "I", "X"] : letter === "W" ? ["V", "O"] : [letter];
    variants = variants.flatMap((prefix) => alternatives.map((alternative) => prefix + alternative)).slice(0, 64);
  }
  return [...new Set(variants.map((key) => key.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean))];
}

export function sameManufacturer(a: string, b: string): boolean {
  const right = new Set(manufacturerMatchKeys(b));
  return manufacturerMatchKeys(a).some((key) => right.has(key));
}

export type ManufacturerDuplicateGroup = { key: string; ids: string[] };

/** Ομάδες με οποιοδήποτε κοινό κλειδί· η ένωση καλύπτει και αλυσίδες ισοδύναμων γραφών. */
export function findManufacturerDuplicates(manufacturers: { id: string; name: string }[]): ManufacturerDuplicateGroup[] {
  const sorted = [...manufacturers].sort((a, b) => a.name.localeCompare(b.name, "el") || a.id.localeCompare(b.id));
  const parent = new Map(sorted.map((m) => [m.id, m.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    parent.set(id, current);
    return current;
  };
  const union = (a: string, b: string) => {
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const keyOwner = new Map<string, string>();
  for (const m of sorted) {
    for (const key of manufacturerMatchKeys(m.name)) {
      const owner = keyOwner.get(key);
      if (owner) union(m.id, owner);
      else keyOwner.set(key, m.id);
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const m of sorted) {
    const id = root(m.id);
    byRoot.set(id, [...(byRoot.get(id) ?? []), m.id]);
  }
  const byId = new Map(sorted.map((m) => [m.id, m]));
  return [...byRoot.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({ key: normalizeManufacturerName(byId.get(ids[0])!.name), ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key, "el"));
}
