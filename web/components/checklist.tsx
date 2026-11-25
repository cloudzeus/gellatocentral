import { CircleCheck, CircleDashed } from "lucide-react";

/** Λίστα «υπάρχει / είναι στο σχέδιο»: πράσινο ό,τι είναι υλοποιημένο, χρυσό ό,τι εκκρεμεί. */
export function Checklist({ items }: { items: readonly { label: string; detail?: string; done: boolean }[] }) {
  return (
    <ul className="divide-y divide-border/70">
      {items.map((i) => (
        <li key={i.label} className="flex items-start gap-3 px-5 py-3">
          {i.done ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-gold" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{i.label}</p>
            {i.detail ? <p className="text-sm text-muted-foreground">{i.detail}</p> : null}
          </div>
          <span className={`shrink-0 text-xs font-semibold ${i.done ? "text-success-ink" : "text-warning-ink"}`}>{i.done ? "Υπάρχει" : "Στο σχέδιο"}</span>
        </li>
      ))}
    </ul>
  );
}
