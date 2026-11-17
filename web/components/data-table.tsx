"use client";
// Κοινός πίνακας δεδομένων: αλλαγή πλάτους στηλών με σύρσιμο, επιλογή ορατών στηλών, μενού ενεργειών ανά γραμμή,
// αριθμοί στοιχισμένοι δεξιά με ψηφία ίσου πλάτους. Οι προτιμήσεις θυμούνται ανά πίνακα (localStorage).
// Αναζήτηση και σελιδοποίηση γίνονται στον server, μέσω του URL (?q=…&page=…): δουλεύουν με οποιοδήποτε πλήθος γραμμών.
// Στο κινητό κάθε γραμμή γίνεται κάρτα (κλάση table-cards του globals.css).
import { ChevronLeft, ChevronRight, Columns3, MoreVertical, Search } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useStored } from "@/lib/use-stored";
import { btn, cn } from "./ui";

export type Column = { key: string; label: string; numeric?: boolean; /** δεν κρύβεται (π.χ. η στήλη που ταυτοποιεί τη γραμμή) */ required?: boolean };
export type Row = { id: string; cells: Record<string, ReactNode>; menu?: ReactNode };
type Prefs = { widths: Record<string, number>; hidden: string[] };
const MIN = 72;

/** Κλείνει ένα αναδυόμενο με πάτημα έξω ή Esc. */
function useDismiss(open: boolean, close: () => void, ...inside: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !inside.some((r) => r.current?.contains(e.target as Node)) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true); // το μενού είναι fixed: με κύλιση θα έμενε πίσω
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(!!at, () => setAt(null), button, panel);
  const toggle = () => {
    if (at) return setAt(null);
    const r = button.current!.getBoundingClientRect();
    // fixed, για να μην κόβεται από την οριζόντια κύλιση του πίνακα· αν δεν χωράει κάτω, ανοίγει προς τα πάνω
    const below = window.innerHeight - r.bottom > 220;
    setAt({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - 200), right: window.innerWidth - r.right });
  };
  return (
    <>
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={!!at} onClick={toggle} className={btn("ghost", "sm")}><MoreVertical /></button>
      {at ? (
        // κλείνει ΜΕΤΑ το πάτημα: αν έκλεινε αμέσως, η φόρμα του στοιχείου θα έφευγε από τη σελίδα πριν υποβληθεί
        <div ref={panel} role="menu" onClick={() => setTimeout(() => setAt(null))} style={{ top: at.top, right: at.right }} className="fixed z-50 min-w-52 rounded-lg border border-border/70 bg-card p-1 text-left shadow-[var(--shadow-pop)]">
          {children}
        </div>
      ) : null}
    </>
  );
}

/** `total` = όλες οι γραμμές που ταιριάζουν στην αναζήτηση (όχι μόνο της σελίδας). */
export type Listing = { q: string; page: number; pageSize: number; total: number; placeholder: string };

export function DataTable({ id, columns, rows, empty, listing }: { id: string; columns: Column[]; rows: Row[]; empty: ReactNode; listing?: Listing }) {
  const [prefs, setPrefs] = useStored<Prefs>(`gs.table.${id}`, { widths: {}, hidden: [] });
  const [drag, setDrag] = useState<Record<string, number> | null>(null); // πλάτη όσο διαρκεί το σύρσιμο
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  useDismiss(picker, () => setPicker(false), pickerRef);

  const visible = columns.filter((c) => c.required || !prefs.hidden.includes(c.key));
  const widths = drag ?? prefs.widths;
  const sized = visible.every((c) => widths[c.key]);
  const hasMenu = rows.some((r) => r.menu);

  /** Τα πλάτη όλων των ορατών στηλών όπως φαίνονται τώρα: από εδώ και πέρα είναι σταθερά σε px. */
  const measure = () => Object.fromEntries(visible.map((c) => [c.key, widths[c.key] ?? table.current!.querySelector<HTMLElement>(`th[data-key="${c.key}"]`)!.offsetWidth]));

  const startResize = (key: string, e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = measure();
    const x = e.clientX;
    let last = start;
    const move = (ev: PointerEvent) => setDrag((last = { ...start, [key]: Math.max(MIN, start[key] + ev.clientX - x) }));
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
    setPrefs({ ...prefs, widths: { ...prefs.widths, ...w, [key]: Math.max(MIN, w[key] + by) } });
  };
  const toggleColumn = (key: string) => setPrefs({ ...prefs, hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key] });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        {listing ? (
          <form role="search" className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" name="q" defaultValue={listing.q} placeholder={listing.placeholder} aria-label="Αναζήτηση" className="h-8.5 w-full rounded-lg border border-input bg-card pl-8 pr-2.5 text-sm pointer-coarse:h-11" />
          </form>
        ) : null}
        <span className="flex-1" />
        {Object.keys(prefs.widths).length || prefs.hidden.length ? <button type="button" className={btn("ghost", "sm")} onClick={() => setPrefs({ widths: {}, hidden: [] })}>Επαναφορά</button> : null}
        <div ref={pickerRef} className="relative max-md:hidden">
          <button type="button" aria-haspopup="true" aria-expanded={picker} onClick={() => setPicker(!picker)} className={btn("outline", "sm")}><Columns3 /> Στήλες</button>
          {picker ? (
            <div className="absolute right-0 z-30 mt-1 min-w-56 rounded-lg border border-border/70 bg-card p-1 shadow-[var(--shadow-pop)]">
              {columns.map((c) => (
                <label key={c.key} className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium", c.required ? "text-muted-foreground" : "cursor-pointer hover:bg-secondary")}>
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={c.required || !prefs.hidden.includes(c.key)} disabled={c.required} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table ref={table} className={cn("table-cards table-desktop text-sm", sized ? "md:table-fixed" : "w-full")} style={sized ? { width: visible.reduce((s, c) => s + widths[c.key], hasMenu ? 56 : 0), minWidth: "100%" } : undefined}>
          {sized ? <colgroup>{visible.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}{hasMenu ? <col style={{ width: 56 }} /> : null}</colgroup> : null}
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {visible.map((c) => (
                <th key={c.key} data-key={c.key} scope="col" className={cn("relative px-5 py-3 font-semibold select-none", c.numeric && "text-right")}>
                  <span className="block truncate">{c.label}</span>
                  <span
                    role="separator" aria-orientation="vertical" aria-label={`Πλάτος στήλης ${c.label}`} tabIndex={0}
                    onPointerDown={(e) => startResize(c.key, e)}
                    onKeyDown={(e) => (e.key === "ArrowLeft" ? nudge(c.key, -16) : e.key === "ArrowRight" ? nudge(c.key, 16) : undefined)}
                    className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none after:absolute after:inset-y-2 after:right-0.5 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-gold focus-visible:outline-none focus-visible:after:w-0.5 focus-visible:after:bg-gold"
                  />
                </th>
              ))}
              {hasMenu ? <th className="w-14 px-2 py-3"><span className="sr-only">Ενέργειες</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/70">
                {visible.map((c, i) => (
                  <td key={c.key} {...(i === 0 ? { "data-primary": true } : { "data-label": c.label })} className={cn("px-5 py-3 md:truncate", c.numeric && "text-right font-medium tabular-nums")}>
                    {r.cells[c.key]}
                  </td>
                ))}
                {hasMenu ? <td data-actions className="px-2 py-1 text-right">{r.menu ? <RowMenu label="Ενέργειες γραμμής">{r.menu}</RowMenu> : null}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <div className="px-5 py-10 text-center text-muted-foreground">{listing?.q ? `Τίποτα δεν ταιριάζει με «${listing.q}».` : empty}</div> : null}
      {listing && listing.total > 0 ? <Pager {...listing} /> : null}
    </div>
  );
}

function Pager({ q, page, pageSize, total }: Listing) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
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
