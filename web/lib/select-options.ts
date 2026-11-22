export type SelectOption = [value: string, text: string, parentValue?: string];

/** Ελληνική αναζήτηση χωρίς διάκριση πεζών και τόνων. */
export const normalizeOption = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("el");
export const filterOptions = (options: SelectOption[], term: string) => {
  const needle = normalizeOption(term.trim());
  return needle ? options.filter(([, text]) => normalizeOption(text).includes(needle)) : options;
};

/** Γονείς πριν από τα παιδιά, με σταθερή σειρά μέσα στο ίδιο επίπεδο. */
export function treeOptions(options: SelectOption[]) {
  const children = new Map<string, SelectOption[]>();
  const roots: SelectOption[] = [];
  const values = new Set(options.map(([value]) => value));
  for (const option of options) {
    const parent = option[2];
    if (parent && values.has(parent)) children.set(parent, [...(children.get(parent) ?? []), option]);
    else roots.push(option);
  }
  const result: SelectOption[] = [];
  const visited = new Set<string>();
  const visit = (items: SelectOption[]) => {
    for (const item of items) {
      if (visited.has(item[0])) continue;
      visited.add(item[0]);
      result.push(item);
      visit(children.get(item[0]) ?? []);
    }
  };
  visit(roots);
  // Ακόμα και ελλιπή/κυκλικά δεδομένα δεν πρέπει να κρύβουν επιλογές από τον χρήστη.
  visit(options);
  return result;
}

export function optionDepth(options: SelectOption[], option: SelectOption) {
  const byId = new Map(options.map((item) => [item[0], item]));
  let depth = 0;
  let parent = option[2];
  // Η επιστροφή στο ίδιο κόμβο σταματά την κυκλική αλυσίδα χωρίς επιπλέον επίπεδο.
  const seen = new Set<string>([option[0]]);
  while (parent && byId.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    depth++;
    parent = byId.get(parent)![2];
  }
  return depth;
}
