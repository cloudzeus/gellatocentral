"use client";

import { useState, useSyncExternalStore, type ChangeEventHandler } from "react";
import { filterOptions, optionDepth, treeOptions, type SelectOption } from "@/lib/select-options";
import { cn } from "@/lib/utils";
import { Input } from "./shadcn/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./shadcn/select";

const subscribe = () => () => {};

const EMPTY = "__empty__";
const toPrimitive = (value: string | undefined) => value === EMPTY ? "" : value;
const toRadix = (value: string | undefined) => value === "" ? EMPTY : value;

/** Native-form compatible combobox· η αναζήτηση αφορά μόνο το UI, η τιμή υποβάλλεται κανονικά στον server. */
export function SearchSelect({ id, name, options, defaultValue, value, onChange, onValueChange, required, disabled, placeholder = "Επιλογή…", ariaLabel, ariaDescribedBy, className }: {
  id?: string;
  name?: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  className?: string;
}) {
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState<"list" | "tree">("list");
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const hierarchical = options.some((option) => option[2]);
  const filtered = filterOptions(options, term);
  const shown = !term && mode === "tree" ? treeOptions(options) : filtered;

  // Η πρώτη HTML απόκριση παραμένει υποβάλλουσα φόρμα ακόμα και χωρίς client JavaScript.
  if (!hydrated) return (
    <select id={id} name={name} defaultValue={defaultValue} value={value} onChange={onChange} required={required} disabled={disabled} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={className}>
      {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
    </select>
  );

  return (
    <Select
      name={name} required={required} disabled={disabled}
      defaultValue={value === undefined ? toRadix(defaultValue) : undefined}
      value={value === undefined ? undefined : toRadix(value)}
      onValueChange={(next) => onValueChange?.(toPrimitive(next) ?? "")}
      onOpenChange={(open) => { if (open) { setTerm(""); setMode("list"); } }}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} className={cn("w-full justify-between bg-card font-normal", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4} className="min-w-64">
        <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-popover p-2" onKeyDown={(e) => e.stopPropagation()}>
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Αναζήτηση στη λίστα…" aria-label="Αναζήτηση επιλογών" className="h-8 bg-card" />
          {hierarchical && !term ? (
            <div role="tablist" aria-label="Τρόπος εμφάνισης επιλογών" className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
              <button type="button" role="tab" aria-selected={mode === "list"} onClick={() => setMode("list")} className={cn("rounded px-2 py-1 text-xs font-medium", mode === "list" ? "bg-card shadow-xs" : "text-muted-foreground")}>Λίστα</button>
              <button type="button" role="tab" aria-selected={mode === "tree"} onClick={() => setMode("tree")} className={cn("rounded px-2 py-1 text-xs font-medium", mode === "tree" ? "bg-card shadow-xs" : "text-muted-foreground")}>Δέντρο</button>
            </div>
          ) : null}
        </div>
        {shown.length ? shown.map((option) => (
          <SelectItem key={option[0] || EMPTY} value={toRadix(option[0])!} className="min-h-9 cursor-pointer" style={!term && mode === "tree" ? { paddingLeft: `${0.5 + optionDepth(options, option) * 1.25}rem` } : undefined}>
            {option[1]}
          </SelectItem>
        )) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">Καμία επιλογή δεν ταιριάζει</p>}
      </SelectContent>
    </Select>
  );
}
