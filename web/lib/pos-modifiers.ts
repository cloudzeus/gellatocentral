// Επιλογές προϊόντος στο ταμείο (γεύσεις, έξτρα, «χωρίς»): έλεγχος και τιμή γραμμής. Καθαρή λογική, χωρίς βάση.
// Η συσκευή στέλνει μόνο ids επιλογών· τιμές και κανόνες τα παίρνουμε πάντα από τον κατάλογο.

export type ModifierKind = "REQUIRED" | "EXTRA" | "REMOVE";
export type CatalogGroup = { id: string; name: string; kind: ModifierKind; pick: number; options: { id: string; name: string; priceCents: number }[] };
export type ChosenOption = { name: string; priceCents: number };

export class ModifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModifierError";
  }
}

/**
 * Ελέγχει τις επιλογές μιας γραμμής και βγάζει την τελική τιμή μονάδας.
 * REQUIRED: ακριβώς `pick`, η ίδια επιλογή επιτρέπεται πολλές φορές (2× φιστίκι). EXTRA/REMOVE: η καθεμία το πολύ μία φορά.
 * Το REMOVE δεν χρεώνεται ποτέ, ό,τι κι αν γράφει η επιλογή.
 */
export function resolveLine(basePriceCents: number, groups: CatalogGroup[], chosenIds: string[]) {
  const where = new Map<string, { group: CatalogGroup; option: CatalogGroup["options"][number] }>();
  for (const group of groups) for (const option of group.options) where.set(option.id, { group, option });

  const count = new Map<string, number>();
  const chosen: (ChosenOption & { rank: number })[] = [];
  const rank = new Map(groups.flatMap((g, gi) => g.options.map((o, oi) => [o.id, gi * 1000 + oi] as const)));
  for (const id of chosenIds) {
    const hit = where.get(id);
    if (!hit) throw new ModifierError("Μια επιλογή δεν υπάρχει πια στο προϊόν· ανανέωσε τον κατάλογο");
    const n = (count.get(id) ?? 0) + 1;
    if (hit.group.kind !== "REQUIRED" && n > 1) throw new ModifierError(`Το «${hit.option.name}» μπαίνει μία φορά`);
    count.set(id, n);
    chosen.push({ name: hit.option.name, priceCents: hit.group.kind === "REMOVE" ? 0 : hit.option.priceCents, rank: rank.get(id)! });
  }
  for (const group of groups) {
    if (group.kind !== "REQUIRED") continue;
    const n = group.options.reduce((s, o) => s + (count.get(o.id) ?? 0), 0);
    if (n !== group.pick) throw new ModifierError(`«${group.name}»: διάλεξε ${group.pick}`);
  }
  // σειρά της απόδειξης: όπως οι ομάδες στον κατάλογο, όχι όπως πατήθηκαν
  chosen.sort((a, b) => a.rank - b.rank);
  const options: ChosenOption[] = chosen.map(({ name, priceCents }) => ({ name, priceCents }));
  return { unitPriceCents: basePriceCents + options.reduce((s, o) => s + o.priceCents, 0), options };
}

/** Η περιγραφή της γραμμής στην απόδειξη: «Χωνάκι 2 μπάλες · Φιστίκι, Φιστίκι, Σαντιγί». */
export function lineDescription(line: { name: string; options?: unknown; note?: string | null }) {
  const options = Array.isArray(line.options) ? (line.options as ChosenOption[]).map((o) => o.name) : [];
  const parts = [...options, ...(line.note ? [line.note] : [])];
  return parts.length ? `${line.name} · ${parts.join(", ")}` : line.name;
}
