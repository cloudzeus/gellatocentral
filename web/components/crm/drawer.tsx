"use client";
// Πλαϊνό πάνελ γρήγορης προβολής: ανοίγει πάνω από τη λίστα (?peek=<id>) και κλείνοντας γυρίζει στην ίδια λίστα,
// με τα ίδια φίλτρα και την ίδια σελίδα. Εγγενές <dialog>: Esc, εστίαση και κλείδωμα κύλισης τα κάνει ο browser.
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { btn } from "../ui";

export function Drawer({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  const close = () => router.replace(closeHref, { scroll: false });
  return (
    <dialog ref={ref} aria-label={title} onClose={close} onClick={(e) => e.target === ref.current && close()} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(30rem,100vw)] max-w-none overflow-y-auto border-l border-border bg-card p-0 text-card-foreground shadow-[var(--shadow-pop)] backdrop:bg-primary/40">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/70 bg-card px-5 py-3">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Γρήγορη προβολή</p>
        <button type="button" onClick={close} aria-label="Κλείσιμο" className={btn("ghost", "sm")}><X /></button>
      </div>
      {children}
    </dialog>
  );
}
