import type { ReactNode } from "react";

/** Ομάδα πεδίων με σαφή θέση στον οδηγό· καθαρά Server Component. */
export function FormSection({ id, step, title, description, children }: { id: string; step: number; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-40 border-t border-border/70 pt-5 first:border-t-0 first:pt-0 sm:col-span-2">
      <header className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>{step}</span>
        <div>
          <h3 id={`${id}-title`} className="text-base leading-7 font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
