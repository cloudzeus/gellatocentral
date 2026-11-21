"use client";
// Η φόρμα καταγραφής ενέργειας CRM: ίδια στη λίστα, στο πλαϊνό πάνελ και στην καρτέλα. Το είδος αλλάζει ποια πεδία φαίνονται.
import { CalendarClock, Mail, Phone, StickyNote, Users } from "lucide-react";
import { useState } from "react";
import { ACTIVITY_KINDS, type ActivityKind } from "@/lib/crm";
import { Submit } from "../submit";
import { btn, cn, Select } from "../ui";

export const KIND_ICON = { note: StickyNote, call: Phone, email: Mail, meeting: Users, task: CalendarClock } as const;
const INPUT = "w-full rounded-lg border border-input bg-card px-2.5 text-sm";
const PLACEHOLDER: Record<ActivityKind, string> = { note: "Τι πρέπει να θυμόμαστε για αυτόν", call: "Τι ειπώθηκε και τι συμφωνήθηκε", email: "Τι γράφτηκε, με λίγα λόγια", meeting: "Τι συζητήθηκε και τι αποφασίστηκε", task: "Λεπτομέρειες (προαιρετικά)" };

export function ActivityForm({ action, contacts, kind: initial = "note", personId, onDone }: { action: (form: FormData) => Promise<void>; contacts: [id: string, name: string][]; kind?: ActivityKind; personId?: string; onDone?: () => void }) {
  const [kind, setKind] = useState<ActivityKind>(initial);
  const task = kind === "task";
  return (
    <form action={async (f) => { await action(f); onDone?.(); }} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <div role="radiogroup" aria-label="Είδος ενέργειας" className="flex flex-wrap gap-1">
        {(Object.keys(ACTIVITY_KINDS) as ActivityKind[]).map((k) => {
          const Icon = KIND_ICON[k];
          return <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium pointer-coarse:min-h-11", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}><Icon className="size-4" aria-hidden /> {ACTIVITY_KINDS[k].label}</button>;
        })}
      </div>
      {task ? <label className="block space-y-1 text-sm font-medium">Τι πρέπει να γίνει <span className="text-destructive">*</span><input name="subject" required maxLength={160} placeholder="π.χ. Να στείλω νέο τιμοκατάλογο" className={cn(INPUT, "h-9 pointer-coarse:h-11")} /></label> : null}
      <label className="block space-y-1 text-sm font-medium">
        <span className={task ? "" : "sr-only"}>{task ? "Λεπτομέρειες" : ACTIVITY_KINDS[kind].label}</span>
        <textarea name="body" required={!task} maxLength={4000} rows={task ? 2 : 3} placeholder={PLACEHOLDER[kind]} className={cn(INPUT, "py-2")} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {kind === "call" || kind === "email" ? (
          <Select label="Κατεύθυνση" name="direction" defaultValue="out" className={cn(INPUT, "h-9 pointer-coarse:h-11")} options={[["out", kind === "call" ? "Τον πήραμε εμείς" : "Το στείλαμε εμείς"], ["in", kind === "call" ? "Μας πήρε αυτός" : "Το λάβαμε"]]} />
        ) : null}
        {contacts.length ? (
          <Select label={task ? "Αφορά" : "Με ποιον"} name="personId" defaultValue={personId ?? ""} className={cn(INPUT, "h-9 pointer-coarse:h-11")} options={[["", "Γενικά την εταιρία"], ...contacts]} />
        ) : null}
        {kind === "call" || kind === "meeting" ? <label className="space-y-1 text-xs font-medium text-muted-foreground">Διάρκεια (λεπτά)<input name="durationMin" type="number" min={1} max={999} inputMode="numeric" className={cn(INPUT, "h-9 w-28 pointer-coarse:h-11")} /></label> : null}
        {task ? <label className="space-y-1 text-xs font-medium text-muted-foreground">Ως πότε<input name="dueAt" type="date" className={cn(INPUT, "h-9 pointer-coarse:h-11")} /></label> : null}
        <Submit className={btn("default", "default", "ml-auto")}>{task ? "Προσθήκη εργασίας" : "Καταγραφή"}</Submit>
      </div>
    </form>
  );
}
