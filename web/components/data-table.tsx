"use client";
// Κοινός πίνακας: resizable/reorderable/pinned στήλες, ορατότητα και σύγχρονες προτιμήσεις ανά χρήστη.
// Αναζήτηση, φίλτρα, server-side ταξινόμηση και σελιδοποίηση μένουν στο URL· το client χειρίζεται μόνο το UI.
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Columns3, Eye, Pencil, Pin, PinOff, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, isValidElement, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { RowMenu } from "./row-menu";
import { SearchSelect } from "./search-select";
import { Checkbox } from "./shadcn/checkbox";
import { Input } from "./shadcn/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./shadcn/tabs";
import { btn, cn } from "./ui";

export type Column = { key: string; label: string; numeric?: boolean; /** δεν κρύβεται (π.χ. η στήλη που ταυτοποιεί τη γραμμή) */ required?: boolean; /** ο server ξέρει να ταξινόμησει με αυτή τη στήλη (?sort=key) */ sortable?: boolean; /** επιτρέπει πολλές γραμμές στο desktop αντί για μία με έλλειψη */ wrap?: boolean };
export type RowDetailsTab = { value: string; label: string; icon?: ReactNode; view: ReactNode };
export type RowDetails = { label?: string; view: ReactNode; edit?: ReactNode; /** πρόσθετα tabs χωρίς να αλλάζει η βασική προβολή */ extra?: RowDetailsTab[] };
export type Row = { id: string; cells: Record<string, ReactNode>; menu?: ReactNode; /** γρήγορες ενέργειες με εικονίδια, πριν από το μενού */ actions?: ReactNode; /** accordion με Προβολή και, όταν επιτρέπεται, Αλλαγή */ details?: RowDetails };
export type BulkAction = { value: string; label: string; confirm?: string; run: (ids: string[]) => Promise<void | string> };

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

export type Filter = { key: string; label: string; value?: string; options: [value: string, text: string][]; /** απόκρυψη της επιλογής «όλα» όταν η λίστα έχει πάντα κατάσταση */ showAll?: boolean };
/** `total` = όλες οι γραμμές που ταιριάζουν στην αναζήτηση (όχι μόνο της σελίδας). */
export type Listing = { q: string; page: number; pageSize: number; total: number; placeholder: string; sort?: string; dir?: "asc" | "desc"; filters?: Filter[]; /** κοινή αναζήτηση εκτός πίνακα, π.χ. δύο συνδεδεμένα αποτελέσματα */ showSearch?: boolean; /** πρόσθετη server κατάσταση, π.χ. επιλεγμένη λίστα αναφοράς */ params?: Record<string, string | undefined>; /** διαφορετικά URL keys όταν συνυπάρχουν πίνακες στην ίδια σελίδα */ keys?: { q?: string; sort?: string; dir?: string; page?: string } };

/** Το URL της λίστας με ό,τι ισχύει τώρα, αλλαγμένο κατά `change`. Κενές τιμές δεν γράφονται. */
const hrefFor = (l: Listing, change: Record<string, string | undefined>) => {
  const keys = { q: "q", sort: "sort", dir: "dir", page: "page", ...l.keys };
  const keyedChange = Object.fromEntries(Object.entries(change).map(([key, value]) => [keys[key as keyof typeof keys] ?? key, value]));
  const all: Record<string, string | undefined> = { ...l.params, [keys.q]: l.q, [keys.sort]: l.sort, [keys.dir]: l.sort ? l.dir : undefined, ...Object.fromEntries((l.filters ?? []).map((f) => [f.key, f.value])), [keys.page]: l.page > 1 ? String(l.page) : undefined, ...keyedChange };
  return `?${new URLSearchParams(Object.entries(all).filter((e): e is [string, string] => !!e[1]))}`;
};

function ListingFilter({ filter }: { filter: Filter }) {
  const root = useRef<HTMLSpanElement>(null);
  const submit = () => {
    const form = root.current?.closest("form");
    if (form) setTimeout(() => form.requestSubmit(), 0);
  };
  const className = cn("h-9 max-w-44 rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-11", filter.value ? "border-primary font-medium" : "border-input text-muted-foreground");
  const options: [string, string][] = [...(filter.showAll === false ? [] : [["", `${filter.label}: όλα`] as [string, string]]), ...filter.options];
  return (
    <span ref={root} className="contents">
      {filter.options.length > 15 ? (
        <SearchSelect name={filter.key} value={filter.value ?? ""} options={options} onChange={submit} onValueChange={submit} ariaLabel={filter.label} className={className} />
      ) : (
        <select name={filter.key} value={filter.value ?? ""} aria-label={filter.label} onChange={submit} className={className}>
          {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      )}
    </span>
  );
}

function ExpandedRow({ row, colSpan, tableId }: { row: Row; colSpan: number; tableId: string }) {
  if (!row.details) return null;
  const extra = row.details.extra ?? [];
  return (
    <tr className="table-expansion border-t border-border/70 bg-secondary/25">
      <td colSpan={colSpan} className="p-3.5 md:p-4">
        <div id={`${tableId}-${row.id}-details`} role="region" aria-label={`Λεπτομέρειες: ${row.details.label ?? "γραμμής"}`}>
          {row.details.edit || extra.length ? (
            <Tabs defaultValue="view">
              <TabsList aria-label="Λειτουργία γραμμής" className={extra.length ? "mb-4 grid h-auto w-full grid-cols-3 [&_button]:px-1.5 [&_button]:text-xs sm:inline-flex sm:w-fit sm:[&_button]:px-3 sm:[&_button]:text-sm" : "mb-3"}>
                <TabsTrigger value="view"><Eye /> Προβολή</TabsTrigger>
                {extra.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.icon}{tab.label}</TabsTrigger>)}
                {row.details.edit ? <TabsTrigger value="edit"><Pencil /> {extra.length ? "Διόρθωση" : "Αλλαγή"}</TabsTrigger> : null}
              </TabsList>
              <TabsContent value="view">{row.details.view}</TabsContent>
              {extra.map((tab) => <TabsContent key={tab.value} value={tab.value}>{tab.view}</TabsContent>)}
              {row.details.edit ? <TabsContent value="edit" className={extra.length ? undefined : "rounded-lg border border-border/70 bg-card p-4"}>{row.details.edit}</TabsContent> : null}
            </Tabs>
          ) : row.details.view}
        </div>
      </td>
    </tr>
  );
}

/** Καθαρό κείμενο για CSV, ακόμα κι όταν το κελί περιέχει Link ή Badge. */
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function DataTable({ id, columns, rows, empty, listing, bulkActions = [] }: { id: string; columns: Column[]; rows: Row[]; empty: ReactNode; listing?: Listing; bulkActions?: BulkAction[] }) {
  const router = useRouter();
  const [prefs, setPrefs, preferenceStatus] = useTablePreferences(id);
  const [drag, setDrag] = useState<Record<string, number> | null>(null);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();
  const pickerRef = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  useDismiss(picker, () => setPicker(false), pickerRef);
  const [previousRows, setPreviousRows] = useState(rows);
  if (previousRows !== rows) {
    // Καθαρίζουμε επιλογές που δεν υπάρχουν πια πριν από το render, όχι με καθυστερημένο effect.
    setPreviousRows(rows);
    setSelected((current) => new Set([...current].filter((selectedId) => rows.some((r) => r.id === selectedId))));
  }

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
  const selectionWidth = 44;
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
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const exportSelected = () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    const lines = [visible.map((c) => csvCell(c.label)).join(","), ...chosen.map((r) => visible.map((c) => csvCell(nodeText(r.cells[c.key]).trim())).join(","))];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${id}-selected.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const runBulk = (action: BulkAction) => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (!ids.length || (action.confirm && !window.confirm(action.confirm))) return;
    setBulkError(null);
    startBulk(async () => {
      try {
        const result = await action.run(ids);
        if (result) setBulkError(result);
        else {
          setSelected(new Set());
          router.refresh();
        }
      } catch {
        setBulkError("Η ομαδική ενέργεια απέτυχε. Δοκίμασε ξανά");
      }
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        {listing && listing.showSearch !== false ? (
          <form
            role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={(e) => {
              // χωρίς JavaScript η φόρμα υποβάλλεται κανονικά· με JavaScript δεν πετά τη σελίδα στην κορυφή
              e.preventDefault();
              const query = new URLSearchParams([...new FormData(e.currentTarget)].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""));
              router.push(`?${query}`, { scroll: false });
            }}
          >
            <span className="relative min-w-40 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name={listing.keys?.q ?? "q"} defaultValue={listing.q} placeholder={listing.placeholder} aria-label="Αναζήτηση" className="bg-card pr-2.5 pl-8" />
            </span>
            {listing.filters?.map((f) => <ListingFilter key={f.key} filter={f} />)}
            {Object.entries(listing.params ?? {}).map(([key, value]) => value ? <input key={key} type="hidden" name={key} value={value} /> : null)}
            {listing.sort ? <><input type="hidden" name={listing.keys?.sort ?? "sort"} value={listing.sort} /><input type="hidden" name={listing.keys?.dir ?? "dir"} value={listing.dir} /></> : null}
            {listing.q || listing.filters?.some((f) => f.value) ? <Link href={hrefFor({ ...listing, q: "", filters: listing.filters?.map((f) => ({ ...f, value: undefined })) }, { [listing.keys?.page ?? "page"]: undefined })} scroll={false} className={btn("ghost", "sm")}>Καθαρισμός</Link> : null}
          </form>
        ) : null}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">{selected.size ? `${selected.size} επιλεγμένες` : "Καμία επιλογή"}</span>
        <select
          aria-label="Ομαδικές ενέργειες" value="" disabled={!selected.size || bulkPending}
          onChange={(e) => {
            const action = e.target.value;
            if (action === "export") exportSelected();
            else if (action) {
              const bulk = bulkActions.find((a) => a.value === action);
              if (bulk) runBulk(bulk);
            }
          }}
          className="h-9 max-w-52 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 pointer-coarse:h-11"
        >
          <option value="">{bulkPending ? "Εκτέλεση…" : "Ομαδικές ενέργειες"}</option>
          <option value="export">Εξαγωγή επιλεγμένων CSV</option>
          {bulkActions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <span role="status" className="text-2xs text-muted-foreground">{statusText}</span>
        {Object.keys(prefs.widths).length || prefs.hidden.length || order.length || prefs.pinned.length ? <button type="button" className={btn("ghost", "sm")} onClick={() => setPrefs({ widths: {}, hidden: [], order: [], pinned: [] })}>Επαναφορά στηλών</button> : null}
        <div ref={pickerRef} className="relative">
          <button type="button" aria-haspopup="true" aria-expanded={picker} onClick={() => setPicker(!picker)} className={btn("outline", "sm")}><Columns3 /> Στήλες</button>
          {picker ? (
            <div className="absolute right-0 z-30 mt-1 max-h-[70dvh] min-w-72 overflow-y-auto rounded-lg border border-border/70 bg-card p-1 shadow-[var(--shadow-pop)]">
              {ordered.map((c, i) => (
                <div key={c.key} className="flex items-center">
                  <label className={cn("flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium", c.required ? "text-muted-foreground" : "cursor-pointer hover:bg-secondary")}>
                    <Checkbox checked={c.required || !prefs.hidden.includes(c.key)} disabled={c.required} onCheckedChange={() => toggleColumn(c.key)} />
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
      {bulkError ? <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">{bulkError}</p> : null}

      <div className="overflow-x-auto">
        <table ref={table} className={cn("table-cards table-desktop text-sm", sized ? "md:table-fixed" : "w-full")} style={sized ? { width: visible.reduce((s, c) => s + widths[c.key], selectionWidth + (hasMenu ? actionsWidth : 0)), minWidth: "100%" } : undefined}>
          {sized ? <colgroup><col style={{ width: selectionWidth }} />{visible.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}{hasMenu ? <col style={{ width: actionsWidth }} /> : null}</colgroup> : null}
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-11 px-3 py-3 text-center">
                <Checkbox aria-label="Επιλογή όλων των γραμμών της σελίδας" checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
              </th>
              {visible.map((c) => (
                <th
                  key={c.key} data-key={c.key} scope="col" draggable
                  aria-sort={listing?.sort === c.key ? (listing.dir === "asc" ? "ascending" : "descending") : undefined}
                  onDragStart={(e) => { setDragCol(c.key); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => dragCol && dragCol !== c.key && e.preventDefault()}
                  onDrop={() => { if (dragCol) moveColumn(dragCol, c.key); setDragCol(null); }}
                  onDragEnd={() => setDragCol(null)}
                  style={prefs.pinned.includes(c.key) ? { left: leftOffsets[c.key] } : undefined}
                  className={cn("relative px-4 py-2.5 font-semibold select-none md:cursor-grab", pinClass(c.key, true), c.numeric && "text-right", dragCol === c.key && "opacity-40")}
                >
                  {listing && c.sortable ? (
                    <Link
                      href={hrefFor(listing, { sort: c.key, dir: listing.sort === c.key && listing.dir === "desc" ? "asc" : "desc", page: undefined })}
                      draggable={false} scroll={false} title={`Ταξινόμηση κατά ${c.label}`}
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
              {hasMenu ? <th style={{ width: actionsWidth }} className="px-2 py-3 md:sticky md:right-0 md:z-20 md:bg-card"><span className="sr-only">Ενέργειες</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={cn("border-t border-border/70", selected.has(r.id) && "bg-primary/5")}>
                    <td data-selection className="w-11 px-3 py-3 text-center">
                      <Checkbox aria-label={`Επιλογή γραμμής${r.details?.label ? `: ${r.details.label}` : ""}`} checked={selected.has(r.id)} onCheckedChange={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                        return next;
                      })} />
                    </td>
                    {visible.map((c, i) => (
                      <td key={c.key} {...(i === 0 ? { "data-primary": true } : { "data-label": c.label })} style={prefs.pinned.includes(c.key) ? { left: leftOffsets[c.key] } : undefined} className={cn("px-4 py-2.5", c.wrap ? "md:align-top md:whitespace-normal md:break-words" : "md:truncate", pinClass(c.key), c.numeric && "text-right font-medium tabular-nums")}>
                        {r.details && i === 0 ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <button type="button" aria-expanded={open} aria-controls={`${id}-${r.id}-details`} aria-label={`${open ? "Σύμπτυξη" : "Ανάπτυξη"}: ${r.details.label ?? "γραμμής"}`} onClick={() => setExpanded(open ? null : r.id)} className={btn("ghost", "sm", "size-7 shrink-0 px-0")}><ChevronRight className={cn("transition-transform", open && "rotate-90")} /></button>
                            <div className="min-w-0 flex-1">{r.cells[c.key]}</div>
                          </div>
                        ) : r.cells[c.key]}
                      </td>
                    ))}
                    {hasMenu ? <td data-actions className="px-2 py-1 text-right md:sticky md:right-0 md:z-10 md:bg-card md:shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]"><span className="inline-flex items-center justify-end gap-0.5"><span className="contents">{r.actions}</span>{r.menu ? <RowMenu label="Ενέργειες γραμμής">{r.menu}</RowMenu> : null}</span></td> : null}
                  </tr>
                  {open ? <ExpandedRow row={r} colSpan={visible.length + 1 + (hasMenu ? 1 : 0)} tableId={id} /> : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-muted-foreground">
          {listing && (listing.q || listing.filters?.some((f) => f.value)) ? (
            <>
              <p>{listing.q ? `Δεν βρέθηκε τίποτα για “${listing.q}”` : "Τίποτα δεν ταιριάζει με τα φίλτρα"}</p>
              <Link href={hrefFor({ ...listing, q: "", filters: listing.filters?.map((f) => ({ ...f, value: undefined })) }, { page: undefined })} scroll={false} className={btn("outline", "sm", "mt-3 pointer-coarse:min-h-11")}>Καθαρισμός</Link>
            </>
          ) : empty}
        </div>
      ) : null}
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
    to < 1 || to > pages ? <span aria-hidden className={btn("outline", "sm", "pointer-events-none opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11")}>{icon}</span> : <Link href={href(to)} scroll={false} aria-label={label} className={btn("outline", "sm", "pointer-coarse:min-h-11 pointer-coarse:min-w-11")}>{icon}</Link>;
  return (
    <nav aria-label="Σελίδες" className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5 text-sm text-muted-foreground">
      <span className="tabular-nums">{from}–{Math.min(total, from + pageSize - 1)} από {total}</span>
      <span className="flex items-center gap-2">
        {arrow(page - 1, "Προηγούμενη σελίδα", <ChevronLeft />)}
        <span className="tabular-nums">Σελίδα {page} από {pages}</span>
        {arrow(page + 1, "Επόμενη σελίδα", <ChevronRight />)}
      </span>
    </nav>
  );
}
