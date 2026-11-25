"use client";
// Δέντρο κατηγοριών με dnd-kit: drop πάνω σε γραμμή = γειτονική θέση, drop στο «Μέσα εδώ» = νέος γονιός.
import { closestCenter, DndContext, type DragEndEvent, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, FolderInput, FolderTree, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { RowMenu } from "@/components/row-menu";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, menuItem, Select } from "@/components/ui";
import { descendantCategoryIds, flattenTradeCategories, moveTradeCategory, type FlatTradeCategory, type TradeCategoryRecord } from "@/lib/trade-category-tree";
import { deleteTradeCategory, saveTradeCategory, saveTradeCategoryLayout, toggleTradeCategory } from "./actions";
import { useBusy } from "@/lib/use-busy";

function CategoryForm({ categories, category, newParentId }: { categories: TradeCategoryRecord[]; category?: TradeCategoryRecord; newParentId?: string }) {
  const excluded = category ? new Set([category.id, ...descendantCategoryIds(categories, category.id)]) : new Set<string>();
  const options = flattenTradeCategories(categories).filter(({ category: c }) => !excluded.has(c.id))
    .map(({ category: c, depth }): [string, string] => [c.id, `${"— ".repeat(depth)}${c.name}`]);
  const fixedParent = newParentId ? categories.find((c) => c.id === newParentId) : undefined;
  return (
    <form action={saveTradeCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={category?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={category?.name} hint="π.χ. Κουβερτούρες ή Μαύρη" />
      {fixedParent ? (
        <><input type="hidden" name="parentId" value={fixedParent.id} /><p className="rounded-lg bg-secondary px-3 py-2 text-sm">Θα προστεθεί μέσα στην <strong>«{fixedParent.name}»</strong>.</p></>
      ) : (
        <Select label="Ανήκει σε" name="parentId" defaultValue={category?.parentId ?? ""} options={[["", "— Κορυφαίο επίπεδο —"], ...options]} hint="Μπορείς να επιλέξεις οποιοδήποτε επίπεδο, εκτός από τα δικά της παιδιά" />
      )}
      <Submit className={btn("default")}>{category ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );
}

function DropInto({ id, name, disabled }: { id: string; name: string; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `into:${id}`, disabled });
  return (
    <span ref={setNodeRef} className={cn("inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-dashed px-2 text-2xs font-semibold transition-colors pointer-coarse:min-h-10", isOver ? "border-gold bg-gold/20 text-gold-ink" : "border-input bg-background text-muted-foreground")}>
      <FolderInput className="size-3.5" /> {isOver ? `Μέσα στην «${name}»` : "Μέσα εδώ"}
    </span>
  );
}

type RowProps = {
  row: FlatTradeCategory;
  categories: TradeCategoryRecord[];
  childCount: number;
  collapsed: boolean;
  activeId: string | null;
  pending: boolean;
  onToggle: () => void;
};

function CategoryRow({ row, categories, childCount, collapsed, activeId, pending, onToggle }: RowProps) {
  const { category: c, depth } = row;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: c.id, disabled: pending });
  const invalidTarget = activeId === c.id || (!!activeId && descendantCategoryIds(categories, activeId).has(c.id));
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("relative", isDragging && "z-10 opacity-35")}>
      <div
        className={cn("group flex min-h-12 items-center gap-1.5 border-b border-border/55 py-1.5 pr-1 transition-colors", isOver && !invalidTarget && "bg-gold/10", depth === 0 ? "bg-secondary/45" : "bg-card")}
        style={{ paddingLeft: `${12 + depth * 24}px` }}
      >
        {childCount ? (
          <button type="button" onClick={onToggle} aria-label={collapsed ? `Ανάπτυξη: ${c.name}` : `Σύμπτυξη: ${c.name}`} aria-expanded={!collapsed} className={btn("ghost", "sm", "size-8! shrink-0 px-0 pointer-coarse:size-10!")}>
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </button>
        ) : <span className="size-8 shrink-0" aria-hidden="true" />}
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={pending}
          aria-label={`Μετακίνηση κατηγορίας: ${c.name}`}
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:size-10"
        >
          <GripVertical className="size-4" />
        </button>
        <FolderTree className={cn("size-4 shrink-0", depth === 0 ? "text-gold-ink" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1 py-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("min-w-0 break-words", depth === 0 ? "font-semibold" : "font-medium")}>{c.name}</span>
            {!c.active ? <Badge>Κρυφή</Badge> : null}
          </div>
          <p className="text-2xs text-muted-foreground">{childCount ? `${childCount} άμεσες υποκατηγορίες` : "Τελική κατηγορία"} · Επίπεδο {depth + 1}</p>
        </div>
        {activeId && !invalidTarget ? <DropInto id={c.id} name={c.name} disabled={pending} /> : null}
        <RowMenu label={`Ενέργειες: ${c.name}`}>
          <Modal menuItem label={<><Plus /> Νέα υποκατηγορία</>} title={`Νέα υποκατηγορία στην «${c.name}»`}><CategoryForm categories={categories} newParentId={c.id} /></Modal>
          <Modal menuItem label={<><Pencil /> Αλλαγή</>} title={`Αλλαγή: ${c.name}`}><CategoryForm categories={categories} category={c} /></Modal>
          <form action={toggleTradeCategory.bind(null, c.id)}><Submit className={menuItem}>{c.active ? <><EyeOff /> Απόκρυψη</> : <><Eye /> Εμφάνιση</>}</Submit></form>
          <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${c.name}`} description="Επιτρέπεται μόνο χωρίς υποκατηγορίες και συνδεδεμένα είδη.">
            <form action={deleteTradeCategory.bind(null, c.id)} className="grid gap-4">
              <p className="text-sm text-muted-foreground">Η κατηγορία θα διαγραφεί οριστικά. Η ενέργεια δεν αναιρείται.</p>
              <Submit className={btn("destructive", "default", "justify-self-end")}>Οριστική διαγραφή</Submit>
            </form>
          </Modal>
        </RowMenu>
      </div>
    </div>
  );
}

export function CategoryTree({ categories: initial }: { categories: TradeCategoryRecord[] }) {
  const [categories, setCategories] = useState(initial);
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initial.filter((c) => c.parentId && initial.some((ch) => ch.parentId === c.id)).map((c) => c.id)));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  useBusy(pending);
  // Συγχρονισμός κατά το render μόνο όταν ο server δώσει πράγματι νέο snapshot, όχι σε κάθε τοπικό drag.
  if (previousInitial !== initial) {
    setPreviousInitial(initial);
    setCategories(initial);
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categories) if (c.parentId) counts.set(c.parentId, (counts.get(c.parentId) ?? 0) + 1);
    return counts;
  }, [categories]);
  const allRows = useMemo(() => flattenTradeCategories(categories), [categories]);
  const visibleRows = useMemo(() => {
    const rows: FlatTradeCategory[] = [];
    let collapsedAt: number | null = null;
    const draggingDescendants = activeId ? descendantCategoryIds(categories, activeId) : new Set<string>();
    for (const row of allRows) {
      if (collapsedAt !== null) {
        if (row.depth > collapsedAt) continue;
        collapsedAt = null;
      }
      // Η γραμμή που σύρεται μένει mounted (αχνή)· κρύβονται μόνο οι απόγονοί της για να μην γίνουν στόχος.
      if (draggingDescendants.has(row.category.id)) continue;
      rows.push(row);
      if (collapsed.has(row.category.id)) collapsedAt = row.depth;
    }
    return rows;
  }, [activeId, allRows, categories, collapsed]);
  const active = categories.find((c) => c.id === activeId);
  const roots = categories.filter((c) => !c.parentId).length;

  const commit = (next: TradeCategoryRecord[]) => {
    const previous = categories;
    setCategories(next);
    setError("");
    setStatus("Αποθήκευση νέας δομής…");
    startTransition(async () => {
      const result = await saveTradeCategoryLayout(next.map(({ id, parentId, position }) => ({ id, parentId, position })));
      if (!result.ok) {
        setCategories(previous);
        setStatus("");
        setError(result.error);
      } else setStatus("Η σειρά και η δομή αποθηκεύτηκαν");
    });
  };

  const dragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || pending) return;
    const activeId = String(dragged.id);
    const overId = String(over.id);
    try {
      if (overId.startsWith("into:")) {
        const parentId = overId.slice(5);
        if (parentId === activeId) return;
        setCollapsed((old) => { const next = new Set(old); next.delete(parentId); return next; });
        commit(moveTradeCategory(categories, activeId, { parentId }));
        return;
      }
      const target = categories.find((c) => c.id === overId);
      if (!target || target.id === activeId) return;
      const activeIndex = allRows.findIndex((r) => r.category.id === activeId);
      const targetIndex = allRows.findIndex((r) => r.category.id === overId);
      commit(moveTradeCategory(categories, activeId, activeIndex < targetIndex
        ? { parentId: target.parentId, afterId: target.id }
        : { parentId: target.parentId, beforeId: target.id }));
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : "Η μετακίνηση δεν είναι δυνατή");
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">Δέντρο κατηγοριών υλικών</h2>
          <p className="text-sm text-muted-foreground">{roots} κύριες οικογένειες · {categories.length} κατηγορίες · κοινές για όλους τους συνδρομητές</p>
        </div>
        <button type="button" onClick={() => setCollapsed(new Set())} className={btn("ghost", "sm")}><ChevronsUpDown /> Ανάπτυξη</button>
        <button type="button" onClick={() => setCollapsed(new Set(categories.filter((c) => childCounts.has(c.id)).map((c) => c.id)))} className={btn("ghost", "sm")}><ChevronsDownUp /> Σύμπτυξη</button>
        <Modal label={<><Plus /> Νέα κατηγορία</>} size="sm" title="Νέα κατηγορία"><CategoryForm categories={categories} /></Modal>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        <span className="inline-flex items-center gap-1.5"><GripVertical className="size-3.5" /> Σύρε από τη λαβή για σειρά ή νέο επίπεδο.</span>
        <span>Εναλλακτικά: Tab στη λαβή, Space, βελάκια, Space.</span>
      </div>
      {error ? <p role="alert" className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive sm:px-5">{error}</p> : null}
      {status ? <p role="status" className="border-b border-success/20 bg-success/10 px-4 py-2 text-xs font-medium text-success-ink sm:px-5">{status}</p> : null}

      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const pointer = pointerWithin(args);
          const into = pointer.find((c) => String(c.id).startsWith("into:"));
          return into ? [into] : pointer.length ? pointer : closestCenter(args);
        }}
        onDragStart={(event) => { setActiveId(String(event.active.id)); setError(""); setStatus(""); }}
        onDragEnd={dragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={visibleRows.map((r) => r.category.id)} strategy={verticalListSortingStrategy}>
          <div role="tree" aria-label="Κατηγορίες υλικών ζαχαροπλαστικής" className="min-w-0">
            {visibleRows.map((row) => (
              <div key={row.category.id} role="treeitem" aria-selected={false} aria-level={row.depth + 1} aria-expanded={childCounts.has(row.category.id) ? !collapsed.has(row.category.id) : undefined}>
                <CategoryRow row={row} categories={categories} childCount={childCounts.get(row.category.id) ?? 0} collapsed={collapsed.has(row.category.id)} activeId={activeId} pending={pending} onToggle={() => setCollapsed((old) => { const next = new Set(old); if (next.has(row.category.id)) next.delete(row.category.id); else next.add(row.category.id); return next; })} />
              </div>
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>{active ? <div className="flex max-w-sm items-center gap-2 rounded-lg border border-gold bg-card px-4 py-3 text-sm font-semibold shadow-[var(--shadow-pop)]"><GripVertical className="size-4 text-muted-foreground" />{active.name}</div> : null}</DragOverlay>
      </DndContext>
      {!categories.length ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">Καμία κατηγορία ακόμα. Ξεκίνα με «Νέα κατηγορία».</p> : null}
      <div className="border-t border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
        Η αρχική ταξινόμηση συνδυάζει πρακτικές <a href="https://www.gs1.org/standards/gpc" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">GS1 GPC</a>, <a href="https://www.valrhona.us/partner-brands/sosa-ingredients" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Sosa</a> και <a href="https://www.puratos.com/products/acti" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Puratos</a>. Μετακίνηση πάνω σε γραμμή = θέση δίπλα της· στο «Μέσα εδώ» = τελευταία υποκατηγορία της.
      </div>
    </Card>
  );
}
