"use client";

// Κοινά κομμάτια του ταμείου του browser (πώληση και τραπέζια): χρώματα, κουμπιά, παράθυρα, ρέστα, κατάσταση πληρωμής.
import { Check, LoaderCircle, type LucideIcon, Minus, Plus, ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { amountCents, amountText, quickAmounts, typeAmount } from "@/lib/till";
import { cn } from "@/lib/utils";

const eur = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });
export const euro = (cents: number) => eur.format(cents / 100);
export const kinds = (n: number) => `${n} ${n === 1 ? "είδος" : "είδη"}`;

// 8 θέσεις χρώματος κατηγορίας (Category.color 1–8), όπως στο Android, σε ζωντανές διαβαθμίσεις των χρωμάτων του web.
// Όλες ανοιχτές στην αρχή τους, ώστε το σκούρο κείμενο (ink) να διαβάζεται πάνω τους.
export type Tone = { from: string; to: string; ink: string };
export const PALETTE: Tone[] = [
  { from: "#C3CBFF", to: "#7F8CFF", ink: "#0B1033" }, // navy → λουλακί (και «Συχνά»)
  { from: "#FFDA7A", to: "#F2A93B", ink: "#2A1A00" }, // χρυσό
  { from: "#8BF2C2", to: "#2CC98F", ink: "#03261A" }, // πράσινο
  { from: "#FFBCA6", to: "#FF7666", ink: "#2E0A06" }, // κοραλί
  { from: "#9EE0FF", to: "#4AAEF5", ink: "#04203A" }, // ουρανός
  { from: "#8DF3E6", to: "#25C2AF", ink: "#022A26" }, // τιρκουάζ
  { from: "#DDF69A", to: "#9BD44A", ink: "#1A2600" }, // λάιμ
  { from: "#FFBFDA", to: "#F26FA4", ink: "#2E0618" }, // ροζ
];
export const grad = (t: Tone) => `linear-gradient(135deg, ${t.from}, ${t.to})`;

export const focus = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const ghost = cn("inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-base font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40", focus);
export const primary = cn("inline-flex h-14 items-center justify-between gap-3 rounded-full bg-foreground px-6 text-lg font-semibold text-background transition-[opacity,transform] hover:opacity-90 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35", focus);

export function Stepper({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  const b = cn("grid size-11 place-items-center rounded-xl hover:bg-secondary", focus);
  return (
    <span className="inline-flex items-center rounded-xl border border-border">
      <button type="button" onClick={() => onChange(value - 1)} aria-label={`Ένα λιγότερο ${label}`} className={b}><Minus className="size-4.5" /></button>
      <span className="min-w-7 text-center text-lg font-bold tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`Ένα ακόμη ${label}`} className={b}><Plus className="size-4.5" /></button>
    </span>
  );
}

/** Παράθυρο πάνω από το ταμείο· Escape κλείνει όταν επιτρέπεται. */
export function Dialog({ label, onClose, children, wide }: { label: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // εστίαση μόνο σε ασφαλές κουμπί (data-autofocus)· αλλιώς στο παράθυρο, ώστε ένα Enter να μην ακυρώνει πληρωμή
    (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-0 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={cn("dark flex max-h-dvh w-full flex-col overflow-hidden bg-sidebar outline-none text-foreground ring-1 ring-border max-sm:h-dvh sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl", wide ? "max-w-4xl" : "max-w-lg")}>
        {children}
      </div>
    </div>
  );
}

export function CashDialog({ totalCents, onContinue, onBack, live, back = "Πίσω στην πώληση", go }: { totalCents: number; onContinue: () => void; onBack: () => void; live: boolean; back?: string; go?: string }) {
  const [given, setGiven] = useState("");
  const cents = amountCents(given);
  const missing = totalCents - cents;
  // πληκτρολόγιο του υπολογιστή: ψηφία, κόμμα/τελεία, Backspace, Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key === "Backspace" ? "⌫" : e.key === "." ? "," : e.key;
      if (/^[\d,⌫]$/.test(k)) { e.preventDefault(); setGiven((g) => typeAmount(g, k)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const key = (k: string) => (
    <button key={k} type="button" onClick={() => setGiven((g) => typeAmount(g, k))} aria-label={k === "⌫" ? "Σβήσιμο" : k === "," ? "Κόμμα" : k}
      className={cn("h-14 rounded-xl bg-card text-2xl font-semibold tabular-nums transition-colors hover:bg-secondary active:bg-secondary", focus)}>{k}</button>
  );
  return (
    <Dialog label="Μετρητά" onClose={onBack} wide>
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-base text-muted-foreground">Έδωσε ο πελάτης</p>
          <p className={cn("pb-1 text-4xl font-semibold tabular-nums", !given && "text-muted-foreground")}>{given || "0"} €</p>
          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={() => setGiven(amountText(totalCents))} className={ghost}>Ακριβώς</button>
            {quickAmounts(totalCents).map((a) => <button key={a} type="button" onClick={() => setGiven(amountText(a))} className={cn(ghost, "tabular-nums")}>{a / 100} €</button>)}
          </div>
          <div className="grid grid-cols-3 gap-2">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map(key)}</div>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-card p-6">
          <div className="flex justify-between text-base"><span className="text-muted-foreground">Σύνολο</span><span className="font-semibold tabular-nums">{euro(totalCents)}</span></div>
          <div className="flex justify-between text-base"><span className="text-muted-foreground">Έδωσε</span><span className="font-semibold tabular-nums">{euro(cents)}</span></div>
          <div aria-live="polite" className="border-t border-border pt-3">
            {missing > 0
              ? <p className="flex items-center gap-2 text-xl font-semibold text-destructive tabular-nums"><TriangleAlert className="size-5" />Λείπουν {euro(missing)}</p>
              : <><p className="text-base text-muted-foreground">Ρέστα στον πελάτη</p><p className="text-4xl font-semibold text-success tabular-nums">{euro(-missing)}</p></>}
          </div>
          <div className="flex-1" />
          <button type="button" onClick={onContinue} disabled={missing > 0} className={cn(primary, "justify-center")}>{go ?? (live ? "Συνέχεια στο τερματικό για την απόδειξη" : "Έκδοση απόδειξης")}</button>
          <button type="button" onClick={onBack} className={ghost}>{back}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Πού βρίσκεται η πληρωμή. id = πώληση ή μερίδιο λογαριασμού (share: η απόδειξη βγαίνει με το τελευταίο μερίδιο). */
export type Status =
  | { kind: "waiting"; saleId: string; totalCents: number; method: string; share?: boolean; slow?: boolean; message?: string }
  | { kind: "paid"; saleId: string; totalCents: number; method: string; share?: boolean; series?: string; aa?: number }
  | { kind: "failed"; message: string }
  | { kind: "unverified" }
  | { kind: "cancel"; saleId: string; totalCents: number; method: string; share?: boolean };

const TONE = { ok: "text-success bg-success/15", wait: "text-warning bg-warning/15", bad: "text-destructive bg-destructive/15", neutral: "text-muted-foreground bg-secondary" };

export function StatusDialog({ status, busy, back = "Πίσω στην πώληση", onClose, onAskCancel, onKeepWaiting, onCancel }: { status: Status; busy: boolean; back?: string; onClose: () => void; onAskCancel: () => void; onKeepWaiting: () => void; onCancel: () => void }) {
  const card = (tone: keyof typeof TONE, label: string, title: string, text: string, actions: ReactNode, Icon: LucideIcon) => (
    <Dialog label={title} onClose={status.kind === "waiting" || status.kind === "cancel" ? undefined : onClose}>
      <div className="space-y-4 p-6 sm:p-8">
        <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", TONE[tone])}><Icon className={cn("size-4", status.kind === "waiting" && "animate-spin")} />{label}</span>
        <h2 className="text-3xl font-semibold">{title}</h2>
        <p className="text-lg text-muted-foreground">{text}</p>
        <div className="flex flex-col gap-2 pt-2">{actions}</div>
      </div>
    </Dialog>
  );
  switch (status.kind) {
    case "waiting": return card("neutral", "Σε εξέλιξη", "Πλήρωσε στο τερματικό", `${status.method} · ${euro(status.totalCents)}. Η χρέωση στάλθηκε στο τερματικό Viva. Η οθόνη αλλάζει μόνη της μόλις τελειώσει.${status.message ? ` ${status.message}` : status.slow ? " Η Viva αργεί να απαντήσει, ρωτάμε ξανά." : ""}`,
      <button type="button" onClick={onAskCancel} disabled={busy} className={ghost}>Ακύρωση πληρωμής</button>, LoaderCircle);
    case "cancel": return card("bad", "Επιβεβαίωση", "Ακύρωση πληρωμής;", "Κάν' το μόνο αν ο πελάτης δεν πλήρωσε. Πρώτα ρωτάμε τη Viva: αν βρει πληρωμή, η απόδειξη κλείνει κανονικά. Αλλιώς η πώληση ακυρώνεται και ο πελάτης δεν χρεώνεται",
      <><button type="button" onClick={onCancel} disabled={busy} className={cn(primary, "justify-center bg-destructive text-white")}>{busy ? "Περίμενε" : "Ναι, ακύρωση"}</button><button type="button" onClick={onKeepWaiting} disabled={busy} className={ghost} data-autofocus>Όχι, περιμένω</button></>, TriangleAlert);
    case "paid": if (status.share) return card("ok", "Ολοκληρώθηκε", `Εισπράχθηκε μερίδιο ${euro(status.totalCents)}`, `${status.method} · η απόδειξη βγαίνει με το τελευταίο μερίδιο`,
      <button type="button" onClick={onClose} className={cn(primary, "justify-center")} data-autofocus>{back}</button>, Check);
      return card("ok", "Ολοκληρώθηκε", `Πληρώθηκε ${euro(status.totalCents)}`, `${status.method}${status.aa != null ? ` · απόδειξη ${status.series ?? ""}-${status.aa}` : ""}`,
      <><button type="button" onClick={onClose} className={cn(primary, "justify-center")} data-autofocus>{back === "Πίσω στην πώληση" ? "Νέα πώληση" : back}</button><Link href={`/receipts/${status.saleId}`} className={ghost}><ReceiptText className="size-4" />Εκτύπωση απόδειξης</Link></>, Check);
    case "failed": return card("bad", "Θέλει ενέργεια", "Η πληρωμή δεν έγινε", status.message,
      <button type="button" onClick={onClose} className={cn(primary, "justify-center")} data-autofocus>{back}</button>, TriangleAlert);
    case "unverified": return card("bad", "Θέλει ενέργεια", "Η πληρωμή δεν επιβεβαιώθηκε", "Η Viva δεν επιβεβαίωσε την πληρωμή. Μην δώσεις το προϊόν ως πληρωμένο· φώναξε τον υπεύθυνο",
      <button type="button" onClick={onClose} className={cn(primary, "justify-center")} data-autofocus>{back}</button>, TriangleAlert);
  }
}
