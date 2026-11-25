"use client";
// Η μία στοίβα κάτω δεξιά: το παράθυρο «Εργασίες» πάνω, τα toasts από κάτω. Σε κινητό πιάνει όλο το πλάτος και
// κάθεται πάνω από την κάτω μπάρα και το safe area. Γράφει το ύψος της στο --feedback-h, ώστε η σελίδα να αφήνει
// τόσο χώρο στο τέλος της και κανένα κουμπί υποβολής να μη μένει κρυμμένο από κάτω της.
import { useEffect, useRef, type ReactNode } from "react";

export function FeedbackStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--feedback-h", el.offsetHeight ? `${el.offsetHeight + 12}px` : "0px"));
    observer.observe(el);
    return () => { observer.disconnect(); root.style.removeProperty("--feedback-h"); };
  }, []);
  return (
    <div ref={ref} className="pointer-events-none fixed right-3 bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom,0px)+0.75rem)] z-50 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2 max-sm:left-3 print:hidden">
      {children}
    </div>
  );
}
