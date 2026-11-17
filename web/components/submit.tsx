"use client";
// Κουμπί υποβολής φόρμας που δείχνει ότι η ενέργεια τρέχει: όσο ο server δουλεύει κλειδώνει (όχι διπλή υποβολή)
// και γυρίζει ένδειξη. Χρησιμοποιείται σε ΚΑΘΕ φόρμα με server action αντί για σκέτο <button>.
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export function Submit({ children, disabled, ...p }: ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button {...p} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {children}
      {pending ? <span className="sr-only" role="status">Γίνεται…</span> : null}
    </button>
  );
}
