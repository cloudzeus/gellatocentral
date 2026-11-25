"use client";
// Πίνακας με κάρτες που ο χρήστης μετακινεί ανάμεσα σε περιοχές (dnd-kit): σύρσιμο με ποντίκι ή αφή, ή με το πληκτρολόγιο
// (Tab στη λαβή, Space, βελάκια, Space). Η διάταξη θυμάται ανά browser. Το περιεχόμενο κάθε κάρτας έρχεται έτοιμο από τον server.
import { closestCorners, DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, LayoutDashboard, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { HIDDEN, type Layout, reconcile } from "@/lib/board";
import { useStored } from "@/lib/use-stored";
import { btn, cn } from "./ui";

export type Area = { id: string; label: string; className: string };
export type Widget = { id: string; title: string; node: ReactNode; className?: string };
function Item({ widget, editing, onHide }: { widget: Widget; editing: boolean; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("relative min-w-0", widget.className, isDragging && "opacity-40", editing && "rounded-xl ring-2 ring-gold/50 ring-offset-2 ring-offset-background")}>
      {editing ? (
        <div className="absolute inset-x-px top-px z-10 flex items-center gap-1 rounded-t-xl border-b border-border bg-card px-2 py-1.5">
          <button type="button" {...attributes} {...listeners} aria-label={`Μετακίνηση: ${widget.title}`} className="flex min-h-9 flex-1 cursor-grab touch-none items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold hover:bg-secondary active:cursor-grabbing pointer-coarse:min-h-11">
            <GripVertical className="size-4 text-muted-foreground" /> {widget.title}
          </button>
          <button type="button" onClick={onHide} aria-label={`Απόκρυψη: ${widget.title}`} title="Απόκρυψη" className={btn("ghost", "sm", "size-9! px-0")}><EyeOff /></button>
        </div>
      ) : null}
      <div className={cn(editing && "pointer-events-none select-none")} aria-hidden={editing || undefined}>{widget.node}</div>
    </div>
  );
}

function Zone({ area, ids, editing, children }: { area: Area; ids: string[]; editing: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: area.id });
  return (
    <SortableContext items={ids} strategy={rectSortingStrategy}>
      <section ref={setNodeRef} aria-label={area.label} className={cn(area.className, "content-start", editing && "min-h-24 rounded-xl outline-2 outline-offset-4 outline-dashed", editing && (isOver ? "outline-gold" : "outline-border"))}>
        {children}
        {editing && ids.length === 0 ? <p className="col-span-full grid min-h-20 place-items-center text-sm text-muted-foreground">Σύρε εδώ μια κάρτα · {area.label}</p> : null}
      </section>
    </SortableContext>
  );
}

export function WidgetBoard({ id, areas, widgets, initial, className }: { id: string; areas: Area[]; widgets: Widget[]; initial: Layout; className?: string }) {
  const [saved, save] = useStored<Layout | null>(`gs.board.${id}`, null);
  const [draft, setDraft] = useState<Layout | null>(null); // διάταξη όσο διαρκεί ένα σύρσιμο
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const layout = draft ?? reconcile(saved, initial, widgets.map((w) => w.id));
  const areaOf = (item: string) => (item in layout ? item : Object.keys(layout).find((a) => layout[a].includes(item)));

  const over = ({ active: a, over: o }: DragOverEvent) => {
    if (!o) return;
    const from = areaOf(String(a.id)), to = areaOf(String(o.id));
    if (!from || !to || from === to) return;
    const at = layout[to].indexOf(String(o.id));
    setDraft({ ...layout, [from]: layout[from].filter((x) => x !== a.id), [to]: [...layout[to].slice(0, at < 0 ? layout[to].length : at), String(a.id), ...layout[to].slice(at < 0 ? layout[to].length : at)] });
  };
  const end = ({ active: a, over: o }: DragEndEvent) => {
    let next = layout;
    const area = o && areaOf(String(o.id));
    if (area && area === areaOf(String(a.id))) {
      const from = layout[area].indexOf(String(a.id)), to = layout[area].indexOf(String(o!.id));
      if (to >= 0 && from !== to) next = { ...layout, [area]: arrayMove(layout[area], from, to) };
    }
    save(next);
    setDraft(null);
    setActive(null);
  };
  const hide = (item: string) => { const from = areaOf(item)!; save({ ...layout, [from]: layout[from].filter((x) => x !== item), [HIDDEN]: [...layout[HIDDEN], item] }); };
  const show = (item: string) => { const home = Object.keys(initial).find((a) => initial[a].includes(item)) ?? areas[0].id; save({ ...layout, [HIDDEN]: layout[HIDDEN].filter((x) => x !== item), [home]: [...layout[home], item] }); };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)} className={btn(editing ? "default" : "outline", "sm")}><LayoutDashboard /> {editing ? "Τέλος προσαρμογής" : "Προσαρμογή οθόνης"}</button>
        {editing ? <button type="button" onClick={() => save(null)} className={btn("ghost", "sm")}><RotateCcw /> Αρχική διάταξη</button> : null}
        {editing ? <p className="text-sm text-muted-foreground">Σύρε τις κάρτες από τη λαβή τους, ή κρύψε όσες δεν χρειάζεσαι</p> : null}
      </div>
      {editing && layout[HIDDEN].length ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">Κρυμμένες:</span>
          {layout[HIDDEN].map((w) => <button key={w} type="button" onClick={() => show(w)} className={btn("outline", "sm")}>+ {byId.get(w)?.title}</button>)}
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e) => setActive(String(e.active.id))} onDragOver={over} onDragEnd={end} onDragCancel={() => { setDraft(null); setActive(null); }}>
        <div className={className}>
          {areas.map((area) => (
            <Zone key={area.id} area={area} ids={layout[area.id]} editing={editing}>
              {layout[area.id].map((w) => byId.has(w) ? <Item key={w} widget={byId.get(w)!} editing={editing} onHide={() => hide(w)} /> : null)}
            </Zone>
          ))}
        </div>
        <DragOverlay>{active ? <div className="rounded-xl border border-gold bg-card px-4 py-3 text-sm font-semibold shadow-[var(--shadow-pop)]"><GripVertical className="mr-2 inline size-4 text-muted-foreground" />{byId.get(active)?.title}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
