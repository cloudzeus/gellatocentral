"use client";
// Κατηγορία myDATA → μόνο οι τύποι Ε3 που επιτρέπει η ΑΑΔΕ, και η φράση «Θα δηλωθεί ως» καθώς αλλάζει η επιλογή.
import { Info } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui";
import { allowedTypes, CATEGORY_LABEL, DOC_TYPES, E3_LABEL, e3Text } from "@/lib/expense-rules";

const DOCS = Object.keys(DOC_TYPES);
const typesFor = (category: string) => [...new Set(DOCS.flatMap((doc) => allowedTypes(doc, category)))];
// μόνο κατηγορίες που έχουν έστω έναν επιτρεπτό τύπο σε παραστατικό που βλέπουμε
const CATEGORIES = Object.keys(CATEGORY_LABEL).filter((c) => typesFor(c).some((t) => E3_LABEL[t]));

export function TypeFields({ category: initialCategory, type: initialType }: { category: string | null; type: string | null }) {
  const [category, setCategory] = useState(initialCategory && CATEGORIES.includes(initialCategory) ? initialCategory : "category2_4");
  // χωρίς περιγραφή στο E3_LABEL δεν τους δείχνουμε (σπάνιοι για εστίαση), εκτός αν είναι ήδη ο επιλεγμένος
  const list = typesFor(category).filter((t) => E3_LABEL[t] || t === initialType);
  const [chosen, setChosen] = useState(initialType ?? "");
  const type = list.includes(chosen) ? chosen : list[0];
  const docs = DOCS.filter((doc) => allowedTypes(doc, category).includes(type));
  return (
    <div className="grid gap-3 sm:col-span-2">
      <Select label="Κατηγορία myDATA" name="mydataCategory" value={category} onValueChange={setCategory} options={CATEGORIES.map((c): [string, string] => [c, `${CATEGORY_LABEL[c]} (${c})`])} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm text-muted-foreground">Τύπος Ε3 · μόνο όσοι επιτρέπονται από την ΑΑΔΕ για αυτή την κατηγορία</legend>
        <div className="flex flex-wrap gap-1.5">
          {list.map((t) => (
            <label key={t} title={t} className="inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-xs text-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-primary/8 has-[:checked]:font-semibold has-[:checked]:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
              <input type="radio" name="mydataType" value={t} checked={t === type} onChange={() => setChosen(t)} className="sr-only" />
              {E3_LABEL[t] ?? t}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="flex gap-2.5 rounded-lg bg-primary/6 p-3 text-sm text-muted-foreground" aria-live="polite">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Θα δηλωθεί ως <b className="font-semibold text-foreground">{e3Text(type)}</b>, κατηγορία «{CATEGORY_LABEL[category]}». Επιτρέπεται σε: {docs.map((d) => `${DOC_TYPES[d]} ${d}`).join(", ") || "κανένα από τα συνηθισμένα"}.</span>
      </p>
    </div>
  );
}
