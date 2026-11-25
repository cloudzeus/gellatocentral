"use client";
// Κουμπί υποβολής φόρμας που δείχνει ότι η ενέργεια τρέχει: όσο ο server δουλεύει κλειδώνει (όχι διπλή υποβολή)
// και γυρίζει ένδειξη. Χρησιμοποιείται σε ΚΑΘΕ φόρμα με server action αντί για σκέτο <button>.
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { useBusy } from "@/lib/use-busy";

export function Submit({ children, disabled, pendingText, ...p }: ComponentProps<"button"> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  useBusy(pending);
  return (
    <button {...p} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
      {pending ? <span className="sr-only" role="status">{pendingText ?? "Γίνεται…"}</span> : null}
    </button>
  );
}
