"use client";
// Κοινός πίνακας: resizable/reorderable/pinned στήλες, ορατότητα και σύγχρονες προτιμήσεις ανά χρήστη.
// Αναζήτηση, φίλτρα, server-side ταξινόμηση και σελιδοποίηση μένουν στο URL· το client χειρίζεται μόνο το UI.
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Columns3, Eye, Pencil, Pin, PinOff, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { Input } from "./shadcn/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./shadcn/tabs";
import { RowMenu } from "./row-menu";
import { btn, cn } from "./ui";

export type Column = { key: string; label: string; numeric?: boolean; /** δεν κρύβεται (π.χ. η στήλη που ταυτοποιεί τη γραμμή) */ required?: boolean; /** ο server ξέρει να ταξινόμησει με αυτή τη στήλη (?sort=key) */ sortable?: boolean };
export type RowDetails = { label?: string; view: ReactNode; edit?: ReactNode };
export type Row = { id: string; cells: Record<string, ReactNode>; menu?: ReactNode; /** γρήγορες ενέργειες με εικονίδια, πριν από το μενού */ actions?: ReactNode; /** accordion με Προβολή και, όταν επιτρέπεται, Αλλαγή */ details?: RowDetails };

/** Κλείνει ένα αναδυόμενο με πάτημα έξω ή Esc. */
function useDismiss(open: boolean, close: () => void, ...inside: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !inside.some((r) => r.current?.contains(e.target as Node)) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export type Filter = { key: string; label: string; value?: string; options: [value: string, text: string][] };
/** `total` = όλες οι γραμμές που ταιριάζουν στην αναζήτηση (όχι μόνο της σελίδας). */
export type Listing = { q: string; page: number; pageSize: number; total: number; placeholder: string; sort?: string; dir?: "asc" | "desc"; filters?: Filter[] };

/** Το URL της λίστας με ό,τι ισχύει τώρα, αλλαγμένο κατά `change`. Κενές τιμές δεν γράφονται. */
const hrefFor = (l: Listing, change: Record<string, string | undefined>) => {
  const all: Record<string, string | undefined> = { q: l.q, sort: l.sort, dir: l.sort ? l.dir : undefined, ...Object.fromEntries((l.filters ?? []).map((f) => [f.key, f.value])), page: l.page > 1 ? String(l.page) : undefined, ...change };
  return `?${new URLSearchParams(Object.entries(all).filter((e): e is [string, string] => !!e[1]))}`;
};

function ExpandedRow({ row, colSpan, tableId }: { row: Row; colSpan: number; tableId: string }) {
  if (!row.details) return null;
  return (
    <tr className="table-expansion border-t border-border/70 bg-secondary/25">
      <td colSpan={colSpan} className="p-4 md:p-5">
        <div id={`${tableId}-${row.id}-details`} role="region" aria-label={`Λεπτομέρειες: ${row.details.label ?? "γραμμής"}`}>
          <Tabs defaultValue="view">
            <TabsList aria-label="Λειτουργία γραμμής" className="mb-4">
              <TabsTrigger value="view"><Eye /> Προβολή</TabsTrigger>
              {row.details.edit ? <TabsTrigger value="edit"><Pencil /> Αλλαγή</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="view">{row.details.view}</TabsContent>
            {row.details.edit ? <TabsContent value="edit" className="rounded-lg border border-border/70 bg-card p-4">{row.details.edit}</TabsContent> : null}
          </Tabs>
        </div>
      </td>
    </tr>
  );
}

export function DataTable({ id, columns, rows, empty, listing }: { id: string; columns: Column[]; rows: Row[]; empty: ReactNode; listing?: Listing }) {
  const [prefs, setPrefs, preferenceStatus] = useTablePreferences(id);
  const [drag, setDrag] = useState<Record<string, number> | null>(null);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  useDismiss(picker, () => setPicker(false), pickerRef);

  const [dragCol, setDragCol] = useState<string | null>(null);
  const order = prefs.order ?? [];
  const ordered = [...columns].sort((a, b) => (order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999));
  // Οι pinned στήλες έρχονται αριστερά· η σχετική σειρά των υπόλοιπων δεν χάνεται.
  const visible = ordered.filter((c) => c.required || !prefs.hidden.includes(c.key)).sort((a, b) => Number(prefs.pinned.includes(b.key)) - Number(prefs.pinned.includes(a.key)));
  const moveColumn = (key: string, before: string) => {
    if (key === before) return;
    const keys = ordered.map((c) => c.key).filter((k) => k !== key);
    keys.splice(keys.indexOf(before), 0, key);
    setPrefs({ ...prefs, order: keys });
  };
  const shift = (key: string, by: -1 | 1) => {
    const keys = ordered.map((c) => c.key), i = keys.indexOf(key), j = i + by;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setPrefs({ ...prefs, order: keys });
  };
  const widths = drag ?? prefs.widths;
  const sized = visible.every((c) => widths[c.key]);
  const hasMenu = rows.some((r) => r.menu);
  const hasActions = rows.some((r) => r.actions);
  const actionsWidth = hasActions ? 184 : 56;
  const lastPinned = visible.findLast((c) => prefs.pinned.includes(c.key))?.key;
  const leftOffsets: Record<string, number> = {};
  let left = 0;
  for (const c of visible) {
    if (!prefs.pinned.includes(c.key)) continue;
    leftOffsets[c.key] = left;
    left += widths[c.key] ?? 160;
  }

  /** Τα πλάτη όλων των ορατών στηλών όπως φαίνονται τώρα: από εδώ και πέρα είναι σταθερά σε px. */
  const measure = () => Object.fromEntries(visible.map((c) => [c.key, widths[c.key] ?? table.current!.querySelector<HTMLElement>(`th[data-key="${c.key}"]`)!.offsetWidth]));
  const startResize = (key: string, e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = measure();
    const x = e.clientX;
    let last = start;
    const move = (ev: PointerEvent) => setDrag((last = { ...start, [key]: Math.max(72, start[key] + ev.clientX - x) }));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      setPrefs({ ...prefs, widths: { ...prefs.widths, ...last } });
      setDrag(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  };
  const nudge = (key: string, by: number) => {
    const w = measure();
    setPrefs({ ...prefs, widths: { ...prefs.widths, ...w, [key]: Math.max(72, w[key] + by) } });
  };
  const toggleColumn = (key: string) => setPrefs({ ...prefs, hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key] });
  const togglePin = (key: string) => {
    const pinned = prefs.pinned.includes(key) ? prefs.pinned.filter((k) => k !== key) : [...prefs.pinned, key];
    // Για να μείνει σταθερό το άθροισμα των left offsets, κάθε pinned στήλη αποκτά ρητό πλάτος.
    setPrefs({ ...prefs, pinned, widths: { ...prefs.widths, ...measure() } });
  };
  const pinClass = (key: string, header = false) => prefs.pinned.includes(key) ? cn(header ? "md:sticky md:z-30 md:bg-card" : "md:sticky md:z-[5] md:bg-card", lastPinned === key && "md:shadow-[8px_0_8px_-8px_rgb(0_0_0/0.18)]") : "";
  const statusText = { syncing: "Συγχρονισμός ρυθμίσεων…", saving: "Αποθήκευση ρυθμίσεων…", saved: "Ρυθμίσεις αποθηκευμένες", local: "Ρυθμίσεις σε αυτόν τον browser" }[preferenceStatus];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        {listing ? (
          <form role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative min-w-40 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="q" defaultValue={listing.q} placeholder={listing.placeholder} aria-label="Αναζήτηση" className="bg-card pr-2.5 pl-8" />
            </span>
            {listing.filters?.map((f) => (
              <select key={f.key} name={f.key} defaultValue={f.value ?? ""} aria-label={f.label} onChange={(e) => e.currentTarget.form?.requestSubmit()} className={cn("h-9 max-w-44 rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-11", f.value ? "border-primary font-medium" : "border-input text-muted-foreground")}>
                <option value="">{f.label}: όλα</option>
                {f.options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            ))}
            {listing.sort ? <><input type="hidden" name="sort" value={listing.sort} /><input type="hidden" name="dir" value={listing.dir} /></> : null}
            {listing.q || listing.filters?.some((f) => f.value) ? <Link href={hrefFor({ ...listing, q: "", filters: listing.filters?.map((f) => ({ ...f, value: undefined })) }, { page: undefined })} className={btn("ghost", "sm")}>Καθαρισμός</Link> : null}
          </form>
        ) : null}
        <span className="flex-1" />
        <span role="status" className="text-2xs text-muted-foreground">{statusText}</span>
        {Object.keys(prefs.widths).length || prefs.hidden.length || order.length || prefs.pinned.length ? <button type="button" className={btn("ghost", "sm")} onClick={() => setPrefs({ widths: {}, hidden: [], order: [], pinned: [] })}>Επαναφορά στηλών</button> : null}
        <div ref={pickerRef} className="relative">
          <button type="button" aria-haspopup="true" aria-expanded={picker} onClick={() => setPicker(!picker)} className={btn("outline", "sm")}><Columns3 /> Στήλες</button>
          {picker ? (
            <div className="absolute right-0 z-30 mt-1 max-h-[70dvh] min-w-72 overflow-y-auto rounded-lg border border-border/70 bg-card p-1 shadow-[var(--shadow-pop)]">
              {ordered.map((c, i) => (
                <div key={c.key} className="flex items-center">
                  <label className={cn("flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium", c.required ? "text-muted-foreground" : "cursor-pointer hover:bg-secondary")}>
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={c.required || !prefs.hidden.includes(c.key)} disabled={c.required} onChange={() => toggleColumn(c.key)} />
                    <span className="truncate">{c.label}</span>
                  </label>
                  <button type="button" aria-pressed={prefs.pinned.includes(c.key)} onClick={() => togglePin(c.key)} aria-label={`${prefs.pinned.includes(c.key) ? "Ξεκαρφίτσωμα" : "Καρφίτσωμα αριστερά"}: ${c.label}`} title={prefs.pinned.includes(c.key) ? "Ξεκαρφίτσωμα" : "Καρφίτσωμα αριστερά"} className={btn("ghost", "sm", "px-1.5")}>{prefs.pinned.includes(c.key) ? <PinOff /> : <Pin />}</button>
                  <button type="button" disabled={i === 0} onClick={() => shift(c.key, -1)} aria-label={`Πιο αριστερά: ${c.label}`} className={btn("ghost", "sm", "px-1.5")}><ChevronUp /></button>
                  <button type="button" disabled={i === ordered.length - 1} onClick={() => shift(c.key, 1)} aria-label={`Πιο δεξιά: ${c.label}`} className={btn("ghost", "sm", "px-1.5")}><ChevronDown /></button>
                </div>
              ))}
              <p className="border-t border-border/70 px-3 pt-2 pb-1 text-2xs text-muted-foreground">Σύρε τις κεφαλίδες για αλλαγή σειράς. Τα βέλη και το πλάτος λειτουργούν και με πληκτρολόγιο.</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table ref={table} className={cn("table-cards table-desktop text-sm", sized ? "md:table-fixed" : "w-full")} style={sized ? { width: visible.reduce((s, c) => s + widths[c.key], hasMenu ? actionsWidth : 0), minWidth: "100%" } : undefined}>
          {sized ? <colgroup>{visible.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}{hasMenu ? <col style={{ width: actionsWidth }} /> : null}</colgroup> : null}
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {visible.map((c) => (
                <th
                  key={c.key} data-key={c.key} scope="col" draggable
                  aria-sort={listing?.sort === c.key ? (listing.dir === "asc" ? "ascending" : "descending") : undefined}
                  onDragStart={(e) => { setDragCol(c.key); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => dragCol && dragCol !== c.key && e.preventDefault()}
                  onDrop={() => { if (dragCol) moveColumn(dragCol, c.key); setDragCol(null); }}
                  onDragEnd={() => setDragCol(null)}
                  style={prefs.pinned.includes(c.key) ? { left: leftOffsets[c.key] } : undefined}
                  className={cn("relative px-5 py-3 font-semibold select-none md:cursor-grab", pinClass(c.key, true), c.numeric && "text-right", dragCol === c.key && "opacity-40")}
                >
                  {listing && c.sortable ? (
                    <Link
                      href={hrefFor(listing, { sort: c.key, dir: listing.sort === c.key && listing.dir === "desc" ? "asc" : "desc", page: undefined })}
                      draggable={false} title={`Ταξινόμηση κατά ${c.label}`}
                      className={cn("inline-flex max-w-full items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", c.numeric && "flex-row-reverse", listing.sort === c.key && "text-foreground")}
                    >
                      <span className="truncate">{c.label}</span>
                      {listing.sort === c.key ? (listing.dir === "asc" ? <ArrowUp className="size-3.5 shrink-0" /> : <ArrowDown className="size-3.5 shrink-0" />) : <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />}
                    </Link>
                  ) : <span className="block truncate">{c.label}</span>}
                  <span
                    role="separator" aria-orientation="vertical" aria-label={`Πλάτος στήλης ${c.label}`} tabIndex={0}
                    onPointerDown={(e) => startResize(c.key, e)}
                    onKeyDown={(e) => (e.key === "ArrowLeft" ? nudge(c.key, -16) : e.key === "ArrowRight" ? nudge(c.key, 16) : undefined)}
                    className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none after:absolute after:inset-y-2 after:right-0.5 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-gold focus-visible:outline-none focus-visible:after:w-0.5 focus-visible:after:bg-gold"
                  />
                </th>
              ))}
              {hasMenu ? <th style={{ width: actionsWidth }} className={cn("px-2 py-3", hasActions && "md:sticky md:right-0 md:bg-card")}><span className="sr-only">Ενέργειες</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-border/70">
                    {visible.map((c, i) => (
                      <td key={c.key} {...(i === 0 ? { "data-primary": true } : { "data-label": c.label })} style={prefs.pinned.includes(c.key) ? { left: leftOffsets[c.key] } : undefined} className={cn("px-5 py-3 md:truncate", pinClass(c.key), c.numeric && "text-right font-medium tabular-nums")}>
                        {r.details && i === 0 ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <button type="button" aria-expanded={open} aria-controls={`${id}-${r.id}-details`} aria-label={`${open ? "Σύμπτυξη" : "Ανάπτυξη"}: ${r.details.label ?? "γραμμής"}`} onClick={() => setExpanded(open ? null : r.id)} className={btn("ghost", "sm", "size-7 shrink-0 px-0")}><ChevronRight className={cn("transition-transform", open && "rotate-90")} /></button>
                            <div className="min-w-0 flex-1">{r.cells[c.key]}</div>
                          </div>
                        ) : r.cells[c.key]}
                      </td>
                    ))}
                    {hasMenu ? <td data-actions className={cn("px-2 py-1 text-right", hasActions && "md:sticky md:right-0 md:bg-card md:shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]")}><span className="inline-flex items-center justify-end gap-0.5"><span className="contents">{r.actions}</span>{r.menu ? <RowMenu label="Ενέργειες γραμμής">{r.menu}</RowMenu> : null}</span></td> : null}
                  </tr>
                  {open ? <ExpandedRow row={r} colSpan={visible.length + (hasMenu ? 1 : 0)} tableId={id} /> : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <div className="px-5 py-10 text-center text-muted-foreground">{listing?.q || listing?.filters?.some((f) => f.value) ? "Τίποτα δεν ταιριάζει με την αναζήτηση και τα φίλτρα" : empty}</div> : null}
      {listing && listing.total > 0 ? <Pager {...listing} /> : null}
    </div>
  );
}

function Pager(listing: Listing) {
  const { page, pageSize, total } = listing;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => hrefFor(listing, { page: p > 1 ? String(p) : undefined });
  const from = (page - 1) * pageSize + 1;
  const arrow = (to: number, label: string, icon: ReactNode) =>
    to < 1 || to > pages ? <span aria-hidden className={btn("outline", "sm", "pointer-events-none opacity-40")}>{icon}</span> : <Link href={href(to)} aria-label={label} className={btn("outline", "sm")}>{icon}</Link>;
  return (
    <nav aria-label="Σελίδες" className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">{from}–{Math.min(total, from + pageSize - 1)} από {total}</span>
      <span className="flex items-center gap-2">
        {arrow(page - 1, "Προηγούμενη σελίδα", <ChevronLeft />)}
        <span className="tabular-nums">Σελίδα {page} από {pages}</span>
        {arrow(page + 1, "Επόμενη σελίδα", <ChevronRight />)}
      </span>
    </nav>
  );
}
