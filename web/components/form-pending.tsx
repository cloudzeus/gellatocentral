"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/** Πραγματική αναμονή Server Action· αόριστη μπάρα, όχι επινοημένο ποσοστό. */
export function FormPending({ label = "Επεξεργασία στον server…", className }: { label?: string; className?: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-2 text-sm font-medium text-muted-foreground", className)}>
      <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="shrink-0">{label}</span>
      <span className="relative h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-primary/15" aria-hidden>
        <span className="process-indicator absolute inset-y-0 w-1/3 rounded-full bg-gold" />
      </span>
    </div>
  );
}
