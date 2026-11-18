"use client";
// Γρήγορες ενέργειες πάνω σε συναλλασσόμενο: κλήση, email, σημείωση, εργασία. Ένα παράθυρο καταγραφής για όλες,
// ώστε ο χρήστης να μη φεύγει από τη λίστα ή την καρτέλα. Η κλήση και το email ανοίγουν και το πρόγραμμα της συσκευής
// (tel: / mailto:)· όταν συνδεθεί τηλεφωνία, η κλήση θα καταγράφεται μόνη της.
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { ACTIVITY_KINDS, type ActivityKind, channelHref, showPhone } from "@/lib/crm";
import { btn, cn } from "../ui";
import { ActivityForm, KIND_ICON } from "./activity-form";

const ORDER: ActivityKind[] = ["call", "email", "note", "task"];

export function QuickActions({ action, name, phone, email, contacts, labels = false, className, personId }: { action: (form: FormData) => Promise<void>; name: string; phone?: string | null; email?: string | null; contacts: [string, string][]; labels?: boolean; className?: string; /** η ενέργεια αφορά αυτό το πρόσωπο */ personId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const open = (k: ActivityKind) => { setKind(k); ref.current?.showModal(); };
  const close = () => { ref.current?.close(); setKind(null); };
  const target = kind === "call" ? phone : kind === "email" ? email : null;
  return (
    <>
      <span className={cn("inline-flex items-center", labels ? "gap-2" : "gap-0.5", className)}>
        {ORDER.map((k) => {
          const Icon = KIND_ICON[k];
          const href = k === "call" && phone ? channelHref("phone", phone) : k === "email" && email ? channelHref("email", email) : undefined;
          const missing = (k === "call" && !phone) || (k === "email" && !email);
          const title = k === "call" ? (phone ? `Κλήση ${showPhone(phone)}` : "Καταγραφή κλήσης (δεν υπάρχει τηλέφωνο)") : k === "email" ? (email ? `Email στο ${email}` : "Καταγραφή email (δεν υπάρχει διεύθυνση)") : ACTIVITY_KINDS[k].verb;
          const cls = labels ? btn(k === "call" ? "default" : "outline", "default", "flex-1") : cn(btn("ghost", "sm"), "w-7.5 px-0", missing && "text-muted-foreground/60");
          const inner = <><Icon aria-hidden />{labels ? ACTIVITY_KINDS[k].label : null}</>;
          return href
            ? <a key={k} href={href} onClick={() => open(k)} aria-label={`${title}: ${name}`} title={title} className={cls}>{inner}</a>
            : <button key={k} type="button" onClick={() => open(k)} aria-label={`${title}: ${name}`} title={title} className={cls}>{inner}</button>;
        })}
      </span>
      <dialog ref={ref} aria-label={`Καταγραφή: ${name}`} onClose={() => setKind(null)} onClick={(e) => e.target === ref.current && close()} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border/70 bg-card p-0 text-left text-card-foreground whitespace-normal shadow-[var(--shadow-pop)] backdrop:bg-primary/55 backdrop:backdrop-blur-sm">
        <div className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg">{name}</h2>
            <p className="text-sm text-muted-foreground">{target ? <>Άνοιξε το πρόγραμμα της συσκευής σου: <a className="font-semibold text-foreground underline underline-offset-2" href={channelHref(kind === "call" ? "phone" : "email", target)}>{kind === "call" ? showPhone(target) : target}</a>. Γράψε εδώ τι έγινε</> : "Ό,τι γράψεις μπαίνει στο χρονολόγιο της καρτέλας"}</p>
          </div>
          <button type="button" onClick={close} aria-label="Κλείσιμο" className={btn("ghost", "sm")}><X /></button>
        </div>
        {/* το key ξαναστήνει τη φόρμα στο είδος που πάτησε ο χρήστης */}
        <div className="p-5">{kind ? <ActivityForm key={kind} action={action} contacts={contacts} kind={kind} personId={personId} onDone={close} /> : null}</div>
      </dialog>
    </>
  );
}
