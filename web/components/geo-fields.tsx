"use client";
// Δυναμικά, αλληλοεξαρτώμενα πεδία γεωγραφίας: Περιφέρεια → Νομός/Π.Ε. → Δήμος → Πόλη → Περιοχή.
// Τα τρία πρώτα είναι ο επίσημος Καλλικράτης (κοινός για όλους)· η πόλη και η περιοχή είναι combobox
// με προτάσεις από τις κοινές λίστες (GeoCity/GeoArea), αλλά δέχονται και ελεύθερο κείμενο.
// Η επιλογή διεύθυνσης από τον χάρτη (AddressField) στέλνει «geo:suggest» στο form και εδώ γεμίζουν όλα μαζί.
// Για χώρα εκτός Ελλάδος δείχνει απλά πεδία κειμένου — ο Καλλικράτης δεν εφαρμόζεται.
import { Fragment, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/geocode";
import { shortRegionName, shortUnitName } from "@/lib/geo/pure";
import { SearchSelect } from "./search-select";
import { cn } from "./ui";

export type GeoChainItem = { code: string; nameEL: string; level: number };
export type GeoCascadeInitial = {
  breadcrumb?: { region: GeoChainItem | null; unit: GeoChainItem | null; municipality: GeoChainItem | null };
  cityId?: string | null;
  city?: string | null;
  areaId?: string | null;
  areaName?: string | null;
  /** Ελεύθερη περιοχή/πολιτεία, μόνο για χώρες εκτός Ελλάδος */
  regionText?: string | null;
};

type CityHit = { id: string; name: string; municipality?: string | null; municipalityCode?: string | null; parents?: string | null };
type AreaHit = { id: string; name: string; postalCode: string | null };

const inputCls = "mt-1 h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11 disabled:opacity-50";

/** Combobox με προτάσεις από δικό μας endpoint· δέχεται και ελεύθερο κείμενο (τότε το id μένει κενό).
 *  Με groupKey/groupHeader οι προτάσεις εμφανίζονται δενδροειδώς: επικεφαλίδα ο γονέας, από κάτω με εσοχή τα παιδιά. */
function Combo<T extends { id: string; name: string }>({ label, name, text, onText, load, onPick, disabled, hint, render, groupKey, groupHeader }: {
  label: string;
  name: string;
  text: string;
  onText: (v: string) => void;
  load: (q: string) => Promise<T[]>;
  onPick: (item: T) => void;
  disabled?: boolean;
  hint?: string;
  render?: (item: T) => ReactNode;
  /** Κλειδί ομάδας (γονέας) ανά πρόταση· αλλαγή τιμής στη λίστα = νέα επικεφαλίδα */
  groupKey?: (item: T) => string | null;
  /** Περιεχόμενο επικεφαλίδας — καλείται με την πρώτη πρόταση της ομάδας */
  groupHeader?: (item: T) => ReactNode;
}) {
  const id = useId();
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (disabled) return;
    const stop = new AbortController();
    const t = setTimeout(() => {
      load(text.trim())
        .then((rows) => {
          if (stop.signal.aborted) return;
          // με ομαδοποίηση: συνεχόμενες ομάδες στη λίστα (το API ταξινομεί με πληθυσμό, οπότε ανακατεύονται)·
          // μέσα στην ομάδα κρατιέται η σειρά του API
          if (groupKey) rows = [...rows].sort((a, b) => (groupKey(a) ?? "￿").localeCompare(groupKey(b) ?? "￿", "el"));
          setItems(rows);
          setActive(0);
          setOpen(rows.length > 0);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
    // το load αλλάζει ταυτότητα όταν αλλάζει ο γονέας (π.χ. δήμος) — θέλουμε ανανέωση τότε
  }, [text, load, disabled, groupKey]);

  const show = open && items.length > 0 && !disabled;
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="block space-y-1 text-sm font-medium">{label}</label>
      <input
        id={id}
        name={name}
        value={text}
        disabled={disabled}
        autoComplete="off"
        maxLength={80}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${id}-${active}` : undefined}
        className={inputCls}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            onPick(items[active]);
            setOpen(false);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show ? (
        <ul id={`${id}-list`} role="listbox" aria-label={`Προτάσεις: ${label}`} className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-pop)]">
          {items.map((item, i) => {
            const g = groupKey?.(item) ?? null;
            const newGroup = g !== null && (i === 0 || groupKey!(items[i - 1]) !== g);
            return (
              <Fragment key={item.id}>
                {newGroup ? (
                  <li aria-hidden className="px-2.5 pt-1.5 pb-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {groupHeader ? groupHeader(item) : g}
                  </li>
                ) : null}
                <li
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onPick(item);
                    setOpen(false);
                  }}
                  onPointerEnter={() => setActive(i)}
                  className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm pointer-coarse:min-h-11", g !== null && "pl-6", i === active && "bg-secondary")}
                >
                  <span className="min-w-0">{render ? render(item) : item.name}</span>
                </li>
              </Fragment>
            );
          })}
        </ul>
      ) : null}
      {hint ? <p className="mt-1 text-xs font-normal text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LevelSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: GeoChainItem[]; onChange: (code: string) => void; disabled?: boolean }) {
  const choices: [string, string][] = [["", "—"], ...options.map((o): [string, string] => [o.code, o.nameEL])];
  return (
    <label className="block min-w-0 space-y-1 text-sm font-medium">
      {label}
      {options.length > 15 ? (
        <SearchSelect ariaLabel={label} value={value} options={choices} disabled={disabled} onValueChange={onChange} className={inputCls} />
      ) : (
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {choices.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
        </select>
      )}
    </label>
  );
}

export function GeoCascade({ country, initial }: { country: string; initial?: GeoCascadeInitial }) {
  const bc = initial?.breadcrumb;
  const [regions, setRegions] = useState<GeoChainItem[]>([]);
  const [units, setUnits] = useState<GeoChainItem[]>([]);
  const [municipalities, setMunicipalities] = useState<GeoChainItem[]>([]);
  const [region, setRegion] = useState(bc?.region?.code ?? "");
  const [unit, setUnit] = useState(bc?.unit?.code ?? "");
  const [municipality, setMunicipality] = useState(bc?.municipality?.code ?? "");
  const [cityText, setCityText] = useState(initial?.city ?? "");
  const [cityId, setCityId] = useState(initial?.cityId ?? "");
  const [areaText, setAreaText] = useState(initial?.areaName ?? "");
  const [areaId, setAreaId] = useState(initial?.areaId ?? "");
  const [note, setNote] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  // σταθερή αναφορά για το deps του Combo· το αν θα ομαδοποιείται αποφασίζει το municipality
  const cityGroupKey = useCallback((c: CityHit) => c.municipalityCode ?? null, []);

  const children = (parent: string | null): Promise<GeoChainItem[]> =>
    fetch(`/api/geo/regions${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`).then((r) => (r.ok ? r.json() : []));

  // Γέμισμα Περιφέρεια → Νομός → Δήμος από κωδικό δήμου (πρόταση χάρτη ή πόλη άλλου δήμου)
  const syncChain = async (code: string): Promise<boolean> => {
    const r = await fetch(`/api/geo/regions?code=${encodeURIComponent(code)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const chain = r?.breadcrumb as { region: GeoChainItem | null; unit: GeoChainItem | null; municipality: GeoChainItem | null } | undefined;
    if (!chain?.municipality) return false;
    const [us, ms] = await Promise.all([chain.region ? children(chain.region.code) : [], chain.unit ? children(chain.unit.code) : []]);
    setUnits(us);
    setMunicipalities(ms);
    setRegion(chain.region?.code ?? "");
    setUnit(chain.unit?.code ?? "");
    setMunicipality(chain.municipality.code);
    return true;
  };

  // Φόρτωση περιφερειών και — για υπάρχουσα εγγραφή — των επιπέδων της επιλογής της
  useEffect(() => {
    void children(null).then(setRegions);
    if (bc?.region) void children(bc.region.code).then(setUnits);
    if (bc?.unit) void children(bc.unit.code).then(setMunicipalities);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Η επιλογή διεύθυνσης από τον χάρτη γεμίζει όλη την αλυσίδα
  useEffect(() => {
    const root = formRef.current?.closest("form");
    if (!root) return;
    const onSuggest = (e: Event) => {
      const s = (e as CustomEvent<AddressSuggestion>).detail;
      if (!s?.municipalityCode) return;
      void (async () => {
        if (!(await syncChain(s.municipalityCode!))) return;
        setCityText(s.cityName ?? s.city ?? "");
        setCityId(s.cityId ?? "");
        setAreaText(s.areaName ?? "");
        setAreaId("");
        setNote("Συμπληρώθηκαν περιφέρεια, νομός, δήμος και πόλη από τον χάρτη. Έλεγξέ τα");
      })();
    };
    root.addEventListener("geo:suggest", onSuggest);
    return () => root.removeEventListener("geo:suggest", onSuggest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (country !== "GR") {
    return (
      <>
        <input type="hidden" name="regionCode" value="" />
        <input type="hidden" name="cityId" value="" />
        <input type="hidden" name="areaId" value="" />
        <label className="block min-w-0 space-y-1 text-sm font-medium">Πόλη<input name="city" maxLength={80} defaultValue={initial?.city ?? ""} className={inputCls} /></label>
        <label className="block min-w-0 space-y-1 text-sm font-medium">Περιοχή / Πολιτεία
          <input name="region" maxLength={80} defaultValue={initial?.regionText ?? ""} className={inputCls} />
          <span className="block text-xs font-normal text-muted-foreground">Για διευθύνσεις εκτός Ελλάδας γράφεται ελεύθερα</span>
        </label>
      </>
    );
  }

  const deepest = municipality || unit || region;
  const regionText = (() => {
    if (unit) {
      const u = units.find((x) => x.code === unit) ?? (bc?.unit?.code === unit ? bc.unit : null);
      if (u) return shortUnitName(u.nameEL);
    }
    const r = regions.find((x) => x.code === region) ?? (bc?.region?.code === region ? bc.region : null);
    return r ? shortRegionName(r.nameEL) : "";
  })();

  const loadCities = (q: string): Promise<CityHit[]> =>
    fetch(`/api/geo/cities?${new URLSearchParams({ ...(municipality ? { municipality } : {}), q })}`).then((r) => (r.ok ? r.json() : []));
  const loadAreas = (q: string): Promise<AreaHit[]> =>
    cityId ? fetch(`/api/geo/areas?${new URLSearchParams({ city: cityId, q })}`).then((r) => (r.ok ? r.json() : [])) : Promise.resolve([]);

  return (
    <div ref={formRef} className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <input type="hidden" name="regionCode" value={deepest} />
      <input type="hidden" name="cityId" value={cityId} />
      <input type="hidden" name="areaId" value={areaId} />
      <input type="hidden" name="region" value={regionText} />
      <LevelSelect
        label="Περιφέρεια"
        value={region}
        options={regions}
        onChange={(code) => {
          setRegion(code);
          setUnit("");
          setMunicipality("");
          setCityText("");
          setCityId("");
          setAreaText("");
          setAreaId("");
          setMunicipalities([]);
          if (code) void children(code).then(setUnits);
          else setUnits([]);
        }}
      />
      <LevelSelect
        label="Νομός / Π.Ε."
        value={unit}
        options={units}
        disabled={!region}
        onChange={(code) => {
          setUnit(code);
          setMunicipality("");
          setCityText("");
          setCityId("");
          setAreaText("");
          setAreaId("");
          if (code) void children(code).then(setMunicipalities);
          else setMunicipalities([]);
        }}
      />
      <LevelSelect
        label="Δήμος"
        value={municipality}
        options={municipalities}
        disabled={!unit}
        onChange={(code) => {
          setMunicipality(code);
          setCityText("");
          setCityId("");
          setAreaText("");
          setAreaId("");
        }}
      />
      <Combo<CityHit>
        label="Πόλη / οικισμός"
        name="city"
        text={cityText}
        onText={(v) => {
          setCityText(v);
          setCityId("");
          setAreaText("");
          setAreaId("");
        }}
        load={loadCities}
        onPick={(c) => {
          setCityText(c.name);
          setCityId(c.id);
          setAreaText("");
          setAreaId("");
          // πόλη άλλου δήμου από τον επιλεγμένο: η αλυσίδα Περιφέρεια → Νομός → Δήμος ακολουθεί την πόλη
          if (c.municipalityCode && c.municipalityCode !== municipality) void syncChain(c.municipalityCode);
        }}
        // χωρίς επιλεγμένο δήμο: δενδροειδώς — επικεφαλίδα η πατρική αλυσίδα (Π.Ε. › Δήμος), από κάτω οι πόλεις με εσοχή
        groupKey={municipality ? undefined : cityGroupKey}
        groupHeader={(c) => c.parents ?? c.municipality ?? ""}
        render={(c) => (
          <span className="block">
            <span className="block font-medium">{c.name}</span>
            {municipality && c.parents ? <span className="block text-xs font-normal text-muted-foreground">{c.parents}</span> : null}
          </span>
        )}
        hint={municipality ? undefined : "Διάλεξε πρώτα δήμο για πιο σχετικές προτάσεις"}
      />
      <Combo<AreaHit>
        label="Περιοχή"
        name="areaName"
        text={areaText}
        onText={(v) => {
          setAreaText(v);
          setAreaId("");
        }}
        load={loadAreas}
        onPick={(a) => {
          setAreaText(a.name);
          setAreaId(a.id);
        }}
        disabled={!cityId}
        hint={cityId ? "Προαιρετικό — γράψε και δικό σου όνομα αν λείπει" : "Πρώτα διάλεξε πόλη από τις προτάσεις"}
      />
      {note ? <p role="status" className="text-xs font-medium text-success-ink sm:col-span-2">{note}</p> : null}
    </div>
  );
}
