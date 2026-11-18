// Το χρονολόγιο ενός συναλλασσόμενου: ό,τι έγραψε άνθρωπος και ό,τι έγινε μόνο του, με χρώμα και εικονίδιο ανά είδος.
import { CalendarClock, Check, CreditCard, FileText, LifeBuoy, Mail, PauseCircle, Phone, Pin, ScanLine, StickyNote, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { dueText, taskState, type TimelineItem } from "@/lib/crm";
import { Submit } from "../submit";
import { Badge, btn, cn } from "../ui";

const LOOK: Record<string, { icon: typeof Phone; cls: string; label: string }> = {
  call: { icon: Phone, cls: "bg-success/12 text-success-ink", label: "Κλήση" },
  email: { icon: Mail, cls: "bg-primary/10 text-primary", label: "Email" },
  meeting: { icon: Users, cls: "bg-gold/18 text-gold-ink", label: "Συνάντηση" },
  note: { icon: StickyNote, cls: "bg-secondary text-secondary-foreground", label: "Σημείωση" },
  task: { icon: CalendarClock, cls: "bg-gold/18 text-gold-ink", label: "Εργασία" },
  file: { icon: FileText, cls: "bg-secondary text-muted-foreground", label: "Αρχείο" },
  document: { icon: ScanLine, cls: "bg-secondary text-muted-foreground", label: "Παραστατικό" },
  ticket: { icon: LifeBuoy, cls: "bg-primary/10 text-primary", label: "Αίτημα" },
  charge: { icon: CreditCard, cls: "bg-secondary text-muted-foreground", label: "Χρέωση" },
  pause: { icon: PauseCircle, cls: "bg-secondary text-muted-foreground", label: "Παύση" },
};
const when = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
const TASK_TONE = { done: "success", overdue: "danger", today: "warning", upcoming: "neutral", open: "neutral" } as const;

export function Timeline({ items, now, touch, compact = false, empty }: { items: TimelineItem[]; now: Date; /** αλλαγή ενέργειας (ολοκλήρωση, καρφίτσωμα, διαγραφή)· χωρίς αυτήν το χρονολόγιο είναι μόνο για ανάγνωση */ touch?: (id: string, what: "done" | "pin" | "delete") => (form: FormData) => Promise<void>; compact?: boolean; empty: string }) {
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="divide-y divide-border/70">
      {items.map((i) => {
        const look = LOOK[i.kind] ?? LOOK.note;
        const state = i.task ? taskState(i.task, now) : null;
        return (
          <li key={i.id} className={cn("flex gap-3 px-5", compact ? "py-2.5" : "py-3.5", i.pinned && "bg-gold/6")}>
            <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", look.cls)}><look.icon className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {i.href ? <Link href={i.href} className={cn("font-semibold underline-offset-2 hover:underline", state === "done" && "line-through opacity-70")}>{i.title}</Link> : <span className={cn("font-semibold", state === "done" && "line-through opacity-70")}>{i.title}</span>}
                {i.pinned ? <Badge tone="warning"><Pin className="size-3" aria-hidden /> Καρφιτσωμένο</Badge> : null}
                {state ? <Badge tone={TASK_TONE[state]}>{state === "done" ? "Έγινε" : dueText(i.task!.dueAt, now)}</Badge> : null}
              </p>
              {i.text ? <p className={cn("mt-0.5 break-words whitespace-pre-line text-sm", i.auto ? "text-muted-foreground" : "", compact && "line-clamp-2")}>{i.text}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">{[look.label, i.person ? `με ${i.person}` : null, i.who, when.format(i.at), i.auto ? "αυτόματα" : null].filter(Boolean).join(" · ")}</p>
            </div>
            {touch && !i.auto && !compact ? (
              <span className="flex shrink-0 items-start gap-0.5">
                {i.task ? <form action={touch(i.id, "done")}><Submit aria-label={state === "done" ? `Αναίρεση ολοκλήρωσης: ${i.title}` : `Ολοκληρώθηκε: ${i.title}`} title={state === "done" ? "Αναίρεση" : "Ολοκληρώθηκε"} className={btn(state === "done" ? "ghost" : "outline", "sm")}><Check /></Submit></form> : null}
                <form action={touch(i.id, "pin")}><Submit aria-label={`${i.pinned ? "Ξεκαρφίτσωμα" : "Καρφίτσωμα"}: ${i.title}`} title={i.pinned ? "Ξεκαρφίτσωμα" : "Καρφίτσωμα στην κορυφή"} className={btn("ghost", "sm")}><Pin /></Submit></form>
                {i.source === "manual" ? <form action={touch(i.id, "delete")}><Submit aria-label={`Διαγραφή: ${i.title}`} title="Διαγραφή" className={btn("ghost", "sm")}><Trash2 /></Submit></form> : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
