"use client";

import { useEffect, useRef, useState } from "react";
import { emptyTablePreferences, type TablePreferences } from "./table-preferences";
import { useStored } from "./use-stored";

export type PreferenceStatus = "syncing" | "saving" | "saved" | "local";

/** Τοπικό cache για ακαριαία απόκριση + αποθήκευση ανά χρήστη στον server. */
export function useTablePreferences(tableId: string) {
  const [stored, setStored] = useStored<TablePreferences>(`gs.table.${tableId}`, emptyTablePreferences);
  const [status, setStatus] = useState<PreferenceStatus>("syncing");
  const edited = useRef(false);
  const setStoredRef = useRef(setStored);
  const queue = useRef(Promise.resolve());
  useEffect(() => { setStoredRef.current = setStored; });

  useEffect(() => {
    let active = true;
    fetch(`/api/table-preferences?table=${encodeURIComponent(tableId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { prefs?: TablePreferences | null } | null) => {
        if (!active) return;
        if (data?.prefs && !edited.current) setStoredRef.current(data.prefs);
        setStatus(data?.prefs ? "saved" : "local");
      })
      .catch(() => active && setStatus("local"));
    return () => { active = false; };
  }, [tableId]);

  const prefs: TablePreferences = { ...emptyTablePreferences, ...stored, order: stored.order ?? [], pinned: stored.pinned ?? [] };
  const setPrefs = (next: TablePreferences) => {
    edited.current = true;
    setStored(next);
    setStatus("saving");
    // Οι αλλαγές στέλνονται με τη σειρά τους· ένα αργό προηγούμενο αίτημα δεν ακυρώνει το νεότερο.
    queue.current = queue.current.then(async () => {
      try {
        const r = await fetch("/api/table-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId, prefs: next }) });
        setStatus(r.ok ? "saved" : "local");
      } catch {
        setStatus("local"); // μένει στον browser και ξαναπροσπαθεί στην επόμενη αλλαγή
      }
    });
  };
  return [prefs, setPrefs, status] as const;
}
