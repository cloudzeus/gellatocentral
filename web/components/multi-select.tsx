"use client";

import { ChevronDown, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useRef, useState } from "react";
import { filterOptions, optionDepth, treeOptions, type SelectOption } from "@/lib/select-options";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./shadcn/button";
import { Checkbox } from "./shadcn/checkbox";
import { Input } from "./shadcn/input";

/** Multiselect με πραγματικά hidden inputs και εμφανή checkbox σε κάθε επιλογή. */
export function MultiSelect({ id, name, options, defaultValues = [], values, onValuesChange, required, disabled, placeholder = "Επιλογή…", ariaDescribedBy }: {
  id?: string;
  name: string;
  options: SelectOption[];
  defaultValues?: string[];
  values?: string[];
  onValuesChange?: (values: string[]) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaDescribedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState<"list" | "tree">("list");
  const [internal, setInternal] = useState(() => new Set(defaultValues));
  const button = useRef<HTMLButtonElement>(null);
  const selected = values ? new Set(values) : internal;
  const hierarchical = options.some((option) => option[2]);
  const filtered = filterOptions(options, term);
  const shown = !term && mode === "tree" ? treeOptions(options) : filtered;
  const labels = options.filter(([value]) => selected.has(value)).map(([, text]) => text);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    if (values === undefined) setInternal(next);
    onValuesChange?.([...next]);
  };
  const clear = () => {
    if (values === undefined) setInternal(new Set());
    onValuesChange?.([]);
  };

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setTerm(""); setMode("list"); } }}>
      {[...selected].map((value) => <input key={value} type="hidden" name={name} value={value} />)}
      {required ? <input value={selected.size ? "selected" : ""} readOnly required tabIndex={-1} aria-hidden className="sr-only" onInvalid={(e) => { e.preventDefault(); setOpen(true); button.current?.focus(); }} /> : null}
      <Popover.Trigger asChild>
        <button ref={button} id={id} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-describedby={ariaDescribedBy}
          className="flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-left text-sm font-normal shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11">
          <span className={cn("min-w-0 flex-1 truncate", !labels.length && "text-muted-foreground")}>{labels.length ? labels.join(", ") : placeholder}</span>
          <span className="flex shrink-0 items-center gap-1">
            {selected.size ? <span className="rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums">{selected.size}</span> : null}
            <ChevronDown className="size-4 text-muted-foreground" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} collisionPadding={8} className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)]">
          <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-popover p-2">
            {options.length > 15 ? <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Αναζήτηση στη λίστα…" aria-label="Αναζήτηση επιλογών" className="h-8 bg-card" /> : null}
            {hierarchical && !term ? (
              <div role="tablist" aria-label="Τρόπος εμφάνισης επιλογών" className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
                <button type="button" role="tab" aria-selected={mode === "list"} onClick={() => setMode("list")} className={cn("rounded px-2 py-1 text-xs font-medium", mode === "list" ? "bg-card shadow-xs" : "text-muted-foreground")}>Λίστα</button>
                <button type="button" role="tab" aria-selected={mode === "tree"} onClick={() => setMode("tree")} className={cn("rounded px-2 py-1 text-xs font-medium", mode === "tree" ? "bg-card shadow-xs" : "text-muted-foreground")}>Δέντρο</button>
              </div>
            ) : null}
          </div>
          <div role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
            {shown.length ? shown.map((option) => (
              <button key={option[0]} type="button" role="option" aria-selected={selected.has(option[0])} onClick={() => toggle(option[0])}
                className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                style={!term && mode === "tree" ? { paddingLeft: `${0.5 + optionDepth(options, option) * 1.25}rem` } : undefined}>
                <Checkbox checked={selected.has(option[0])} tabIndex={-1} className="pointer-events-none" />
                <span className="min-w-0 flex-1">{option[1]}</span>
              </button>
            )) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">Καμία επιλογή δεν ταιριάζει</p>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <span className="text-xs text-muted-foreground tabular-nums">{selected.size} επιλεγμένα</span>
            {selected.size ? <button type="button" onClick={clear} className={buttonVariants({ variant: "ghost", size: "sm" })}><X /> Καθαρισμός</button> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
