"use client";
// Επεξεργαστής γραμμών συνταγής: αναζήτηση είδους με φίλτρο, drag & drop ταξινόμηση και
// ζωντανό preview της τεχνικής ανάλυσης (ο ίδιος κώδικας υπολογισμού με τον server —
// lib/recipe-analysis.ts είναι καθαρό). Η αποθήκευση στέλνει τις γραμμές ως JSON.
import { GripVertical, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RecipeAnalysisPanel } from "@/components/recipe-analysis-panel";
import { Submit } from "@/components/submit";
import { btn, cn } from "@/components/ui";
import { analyzeRecipe, piecesFromGrams, type MaterialComposition } from "@/lib/recipe-analysis";

export type EditorItem = {
  id: string;
  name: string;
  unitCode: string;
  composition: MaterialComposition | null;
  costHundredthsPerGram: number;
  gramsPerPiece: number | null;
};
export type EditorLine = { key: string; genericItemId: string; grams: number };

let seq = 0;
const nextKey = () => `l${++seq}_${Date.now().toString(36)}`;

export function RecipeItemsEditor({
  items,
  initialLines,
  recipeType,
  action,
  recipeId,
}: {
  items: EditorItem[];
  initialLines: EditorLine[];
  recipeType: string;
  action: (form: FormData) => Promise<void>;
  recipeId: string;
}) {
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("el-GR");
    const used = new Set(lines.map((l) => l.genericItemId));
    const pool = items.filter((i) => !used.has(i.id));
    return (q ? pool.filter((i) => i.name.toLocaleLowerCase("el-GR").includes(q)) : pool).slice(0, 12);
  }, [items, lines, query]);

  // Ζωντανή ανάλυση: είδη χωρίς σύσταση δεν τροφοδοτούν PAC/POD — επισημαίνονται στη γραμμή
  const analysis = useMemo(
    () =>
      analyzeRecipe(
        lines.map((l) => {
          const item = byId.get(l.genericItemId);
          return {
            grams: l.grams,
            material: { ...(item?.composition ?? {}), costHundredthsPerGram: item?.costHundredthsPerGram ?? 0, gramsPerPiece: item?.gramsPerPiece ?? null },
          };
        }),
        recipeType,
      ),
    [lines, byId, recipeType],
  );

  const setGrams = (key: string, raw: string) => {
    const g = Math.round(Number(raw.replace(",", ".")));
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, grams: Number.isFinite(g) && g >= 0 ? g : 0 } : l)));
  };
  const move = (to: number) => {
    const from = dragFrom.current;
    if (from == null || from === to) return;
    setLines((ls) => {
      const next = [...ls];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  };

  const payload = JSON.stringify(lines.filter((l) => l.grams > 0).map((l) => ({ genericItemId: l.genericItemId, grams: l.grams })));

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="items" value={payload} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Αναζήτηση είδους για προσθήκη…"
          className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm"
          aria-label="Προσθήκη είδους στη συνταγή"
        />
        {open && matches.length ? (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
            {matches.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setLines((ls) => [...ls, { key: nextKey(), genericItemId: i.id, grams: 0 }]);
                    setQuery("");
                  }}
                >
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  {!i.composition ? <span className="text-xs text-gold-ink">χωρίς σύσταση</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ul className="grid gap-1.5">
        {lines.map((l, idx) => {
          const item = byId.get(l.genericItemId);
          return (
            <li
              key={l.key}
              draggable
              onDragStart={() => (dragFrom.current = idx)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(idx);
              }}
              onDrop={() => {
                move(idx);
                dragFrom.current = null;
                setDragOver(null);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDragOver(null);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
                dragOver === idx ? "border-primary" : "border-border/70",
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-label="Σύρε για αλλαγή σειράς" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item?.name ?? "—"}</span>
                {!item?.composition ? <span className="text-xs text-gold-ink">χωρίς σύσταση — δεν μετράει σε PAC/POD</span> : null}
              </span>
              {item?.gramsPerPiece ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">≈ {piecesFromGrams(item, l.grams).toLocaleString("el-GR", { maximumFractionDigits: 1 })} τεμ.</span> : null}
              <input
                value={l.grams || ""}
                onChange={(e) => setGrams(l.key, e.target.value)}
                inputMode="numeric"
                placeholder="0"
                aria-label={`Γραμμάρια για ${item?.name ?? "είδος"}`}
                className="h-9 w-24 rounded-lg border border-input bg-card px-2 text-right text-sm tabular-nums"
              />
              <span className="shrink-0 text-xs text-muted-foreground">g</span>
              <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className={btn("ghost", "sm")} aria-label="Αφαίρεση γραμμής">
                <Trash2 />
              </button>
            </li>
          );
        })}
        {!lines.length ? <li className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Καμία γραμμή — αναζήτησε είδος παραπάνω για να ξεκινήσεις</li> : null}
      </ul>

      <div className="grid gap-2 rounded-lg border border-border/70 bg-secondary/30 p-4">
        <p className="text-sm font-semibold">
          Ανάλυση συνταγής <span className="text-xs font-normal text-muted-foreground">(ζωντανά — σύνολο {analysis.totalWeight.toLocaleString("el-GR")} g)</span>
        </p>
        {analysis.totalWeight > 0 ? <RecipeAnalysisPanel analysis={analysis} recipeType={recipeType} /> : <p className="text-sm text-muted-foreground">Πρόσθεσε ποσότητες για να δεις την ανάλυση</p>}
      </div>

      <div className="flex justify-end">
        <Submit className={btn("default")}>Αποθήκευση γραμμών</Submit>
      </div>
    </form>
  );
}
