// Πλέγμα δικαιωμάτων: μία γραμμή ανά περιοχή, ένα κουτάκι ανά ενέργεια (Προβολή / Προσθήκη / …).
// Κοινό για ρόλους και ομάδες, στην επιχείρηση και στην πλατφόρμα. Ό,τι δεν έχει ο ίδιος ο χρήστης δεν επιλέγεται.
import { ACTION_LABEL, type Action } from "@/lib/permissions";

export type MatrixArea = { key: string; group: string; label: string; hint: string; actions: readonly Action[] };

export function PermissionMatrix({ areas, selected, mine }: { areas: readonly MatrixArea[]; selected: readonly string[]; mine: readonly string[] }) {
  const groups = [...new Set(areas.map((a) => a.group))];
  return (
    <div className="space-y-3 sm:col-span-2">
      {groups.map((g) => (
        <fieldset key={g} className="rounded-lg border border-border/70 p-3">
          <legend className="px-1 text-xs font-semibold text-muted-foreground">{g}</legend>
          <div className="divide-y divide-border/50">
            {areas
              .filter((a) => a.group === g)
              .map((a) => (
                <div key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
                  <span className="min-w-44 flex-1">
                    <span className="text-sm font-semibold">{a.label}</span>
                    <span className="block text-xs text-muted-foreground">{a.hint}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {a.actions.map((act) => {
                      const key = `${a.key}.${act}`;
                      const allowed = mine.includes(key);
                      return (
                        <label key={key} title={allowed ? undefined : "Δεν το έχεις εσύ"} className={`flex min-h-10 items-center gap-1.5 text-sm whitespace-nowrap ${allowed ? "cursor-pointer" : "opacity-50"}`}>
                          <input type="checkbox" name="permissions" value={key} defaultChecked={selected.includes(key)} disabled={!allowed} className="size-4 accent-[var(--primary)]" />
                          {ACTION_LABEL[act]}
                        </label>
                      );
                    })}
                  </span>
                </div>
              ))}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">Η «Προβολή» μιας ενότητας μπαίνει αυτόματα όταν επιλέγεις οποιαδήποτε άλλη ενέργειά της — αλλιώς η οθόνη δεν θα άνοιγε.</p>
    </div>
  );
}
