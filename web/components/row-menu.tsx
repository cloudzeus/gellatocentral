"use client";
// Μενού ενεργειών γραμμής (⋮) — κοινό για DataTable και απλούς πίνακες.
// Οι ενέργειες μπαίνουν ως children: <Link role="menuitem" className={menuItem}>, <Modal menuItem>, ή <form> με Submit className={menuItem}.
// Το πάνελ μένει στο DOM κρυμμένο: παράθυρα (dialog) που ανοίγουν από επιλογές του δεν αποσυνδέονται όταν κλείνει το μενού.
import { MoreVertical } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { btn } from "./ui";

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

export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
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
      {/* Κλείνει ΜΕΤΑ το πάτημα: αν έκλεινε αμέσως, η φόρμα του στοιχείου θα έφευγε από τη σελίδα πριν υποβληθεί */}
      <div ref={panel} role="menu" hidden={!at} onClick={() => setTimeout(() => setAt(null))} style={at ? { top: at.top, right: at.right } : undefined} className="fixed z-50 min-w-52 rounded-lg border border-border/70 bg-card p-1 text-left shadow-[var(--shadow-pop)]">
        {children}
      </div>
    </>
  );
}
