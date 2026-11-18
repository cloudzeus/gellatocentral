"use client";
// Πεδίο διεύθυνσης με προτάσεις από τον χάρτη όσο γράφει ο χρήστης. Με την επιλογή γεμίζουν και τα υπόλοιπα πεδία της
// ίδιας φόρμας (Τ.Κ., πόλη, περιοχή, χώρα, συντεταγμένες). Ο χρήστης μπορεί πάντα να τα αγνοήσει και να γράψει ό,τι θέλει.
import { MapPin } from "lucide-react";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/geocode";
import { cn } from "./ui";

export function AddressField({ label, hint, ...p }: { label: string; hint?: string } & ComponentProps<"input">) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [filled, setFilled] = useState("");

  useEffect(() => {
    if (q.trim().length < 4) return;
    const stop = new AbortController();
    // περιμένουμε να σταματήσει να γράφει: ένα αίτημα ανά παύση, όχι ανά γράμμα
    const t = setTimeout(() => fetch(`/api/address-suggest?q=${encodeURIComponent(q.trim())}`, { signal: stop.signal }).then((r) => (r.ok ? r.json() : [])).then((rows: AddressSuggestion[]) => { setItems(rows); setActive(0); setOpen(true); }).catch(() => {}), 350);
    return () => { clearTimeout(t); stop.abort(); };
  }, [q]);

  function pick(s: AddressSuggestion) {
    const form = input.current?.form;
    const set = (name: string, value: string | null) => { const el = form?.elements.namedItem(name); if (value && (el instanceof HTMLInputElement || (el instanceof HTMLSelectElement && [...el.options].some((o) => o.value === value)))) el.value = value; };
    if (input.current) input.current.value = s.street;
    set("postalCode", s.postalCode); set("city", s.city); set("region", s.region); set("countryCode", s.countryCode);
    set("latitude", s.latitude.toFixed(6).replace(".", ",")); set("longitude", s.longitude.toFixed(6).replace(".", ","));
    setOpen(false); setItems([]);
    setFilled(`Συμπληρώθηκαν Τ.Κ., πόλη${s.region ? ", περιοχή" : ""} και θέση στον χάρτη. Έλεγξέ τα`);
  }
  const show = open && items.length > 0;
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="block space-y-1 text-sm font-medium">{label}{p.required ? <span className="text-destructive"> *</span> : null}</label>
      <input
        {...p} id={id} ref={input} autoComplete="off" role="combobox" aria-expanded={show} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={show ? `${id}-${active}` : undefined}
        className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11"
        onChange={(e) => { setQ(e.target.value); setFilled(""); if (e.target.value.trim().length < 4) setOpen(false); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
      />
      {show ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Προτάσεις διεύθυνσης" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-pop)]">
          {items.map((s, i) => (
            // onPointerDown: η επιλογή γίνεται πριν το πεδίο χάσει την εστίαση και κλείσει η λίστα
            <li key={s.label} id={`${id}-${i}`} role="option" aria-selected={i === active} onPointerDown={(e) => { e.preventDefault(); pick(s); }} onPointerEnter={() => setActive(i)} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm pointer-coarse:min-h-11", i === active && "bg-secondary")}>
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0">{s.label}</span>
            </li>
          ))}
          <li aria-hidden className="px-2.5 pt-1 pb-0.5 text-right text-2xs text-muted-foreground">© OpenStreetMap</li>
        </ul>
      ) : null}
      <p role="status" className={cn("mt-1 text-xs", filled ? "font-medium text-success-ink" : "text-muted-foreground")}>{filled || hint || "Γράψε οδό και αριθμό: διάλεξε από τις προτάσεις και γεμίζουν τα υπόλοιπα"}</p>
    </div>
  );
}
