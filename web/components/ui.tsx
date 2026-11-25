// Κοινά στοιχεία, ίδια εμφάνιση με το Gelato System. Παραμένουν Server Components·
// μόνο τα shadcn primitives με πραγματική αλληλεπίδραση μπαίνουν στο client bundle.
import { Info, type LucideIcon } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import type { SelectOption } from "@/lib/select-options";
import { MultiSelect } from "./multi-select";
import { SearchSelect } from "./search-select";
import { buttonVariants } from "./shadcn/button";
import { Input } from "./shadcn/input";
import { Label } from "./shadcn/label";
import { Textarea } from "./shadcn/textarea";

export { cn } from "@/lib/utils";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "success" | "destructive" | "outline" | "ghost";
type ButtonSize = "default" | "sm" | "lg";

/** Συμβατό API με τα υπάρχοντα κουμπιά, πάνω στο κοινό shadcn variant system. */
export const btn = (variant: ButtonVariant = "default", size: ButtonSize = "default", extra?: string) => cn(buttonVariants({ variant, size }), extra);

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-card)]", className)} {...p} />;
}

/** Κοινή ανάγνωση στα expand: διακριτικές ετικέτες, καθαρές τιμές και λεπτοί διαχωρισμοί. */
export function DetailGrid({ className, ...p }: ComponentProps<"dl">) {
  return <dl className={cn("grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70 text-sm [&_dd]:mt-1.5 [&_dd]:break-words [&_dd]:font-medium [&_dt]:text-xs [&_dt]:font-medium [&_dt]:text-muted-foreground [&>div]:min-w-0 [&>div]:bg-card [&>div]:p-4", className)} {...p} />;
}

const TONE = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success/12 text-success-ink",
  warning: "bg-warning/20 text-warning-ink",
  danger: "bg-destructive/15 text-destructive",
};
/** `icon`: προαιρετικό εικονίδιο lucide πριν από το κείμενο· διακοσμητικό, το νόημα το λέει η λέξη. */
export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: keyof typeof TONE; icon?: LucideIcon | null; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold", TONE[tone])}>{Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}{children}</span>;
}

/** Κεφαλίδα σελίδας + περιεχόμενο, όπως το AppLayout του Gelato System. */
export function Page({ section, title, description, actions, children }: { section: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-background/70 px-4 py-2 backdrop-blur-xl backdrop-saturate-150 max-lg:pl-16 lg:px-8 print:hidden">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-2xs font-medium text-muted-foreground">{section}</p>
          <h1 className="break-words text-base font-semibold leading-tight lg:text-lg" title={title}>{title}</h1>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      <main className="flex-1 px-4 pt-5 pb-[calc(var(--bottom-nav-h,0px)+1.5rem)] lg:px-8 print:p-0">{children}</main>
    </>
  );
}

const FIELD = "h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11";

/**
 * Επεξήγηση πεδίου ως tooltip δίπλα στην ετικέτα: εικονίδιο (i) που ανοίγει με hover ή εστίαση
 * (πληκτρολόγιο/αναγνώστης οθόνης), pure CSS χωρίς client JavaScript. Το κείμενο συνδέεται με
 * aria-describedby, οπότε παραμένει προσβάσιμο· η φόρμα μένει μικρή όσο μικρό κι αν είναι το πεδίο.
 */
function HintTip({ text, id }: { text: string; id: string }) {
  return (
    <span className="group/tip relative inline-flex align-middle" tabIndex={0} aria-label="Επεξήγηση πεδίου">
      <Info className="size-3.5 cursor-help text-muted-foreground transition-colors group-hover/tip:text-foreground group-focus-within/tip:text-foreground" />
      <span
        id={id}
        role="tooltip"
        className="invisible absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-normal leading-relaxed text-card-foreground opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Ετικέτα με αστεράκι υποχρεωτικού και tooltip επεξήγησης. */
function FieldLabel({ id, label, required, hint, hintId }: { id: string; label: string; required?: boolean; hint?: string; hintId: string }) {
  return (
    <Label htmlFor={id} className="inline-flex items-center gap-1.5">
      {label}
      {required ? <span className="text-destructive"> *</span> : null}
      {hint ? <HintTip text={hint} id={hintId} /> : null}
    </Label>
  );
}

/** Πεδίο με προσβάσιμη ετικέτα, βοήθεια και σφάλμα· χωρίς client JavaScript. */
export function Field({ label, hint, error, id: suppliedId, ...p }: { label: string; hint?: string; error?: string } & ComponentProps<"input">) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const messageId = `${id}-message`;
  return (
    <div className="min-w-0 space-y-1">
      <FieldLabel id={id} label={label} required={p.required} hint={hint} hintId={messageId} />
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...p} />
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/** Πολύγραμμο πεδίο για κείμενο που δεν πρέπει να στριμώχνεται σε input. */
export function TextareaField({ label, hint, error, id: suppliedId, ...p }: { label: string; hint?: string; error?: string } & ComponentProps<"textarea">) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const messageId = `${id}-message`;
  return (
    <div className="min-w-0 space-y-1">
      <FieldLabel id={id} label={label} required={p.required} hint={hint} hintId={messageId} />
      <Textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? messageId : undefined} {...p} />
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

const singleValue = (value: ComponentProps<"select">["value"]) => value === undefined || Array.isArray(value) ? undefined : String(value);

/** Μικρές λίστες μένουν native· πάνω από 15 επιλογές αποκτούν αναζήτηση και δενδρική προβολή. */
export function Select({ label, options, hint, id: suppliedId, onValueChange, ...p }: { label: string; options: SelectOption[]; hint?: string; onValueChange?: (value: string) => void } & ComponentProps<"select">) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const hintId = `${id}-hint`;
  return (
    <div className="min-w-0 space-y-1">
      <FieldLabel id={id} label={label} required={p.required} hint={hint} hintId={hintId} />
      {options.length > 15 ? (
        <SearchSelect id={id} name={p.name} options={options} defaultValue={singleValue(p.defaultValue)} value={singleValue(p.value)} required={p.required} disabled={p.disabled} onChange={p.onChange} onValueChange={onValueChange} ariaLabel={label} ariaDescribedBy={hint ? hintId : undefined} className={cn(FIELD, p.className)} />
      ) : (
        <select id={id} aria-describedby={hint ? hintId : undefined} className={cn(FIELD, p.className)} {...p}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      )}
    </div>
  );
}

/** Πολλαπλή επιλογή με εμφανή checkbox, κοινή ετικέτα και native hidden inputs. */
export function MultiSelectField({ label, hint, error, id: suppliedId, ...p }: { label: string; hint?: string; error?: string } & ComponentProps<typeof MultiSelect>) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const messageId = `${id}-message`;
  return (
    <div className="min-w-0 space-y-1">
      <FieldLabel id={id} label={label} required={p.required} hint={hint} hintId={messageId} />
      <MultiSelect id={id} ariaDescribedBy={hint || error ? messageId : undefined} {...p} />
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/** Στοιχείο μενού γραμμής πίνακα (σύνδεσμος ή κουμπί φόρμας). */
export const menuItem = "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
