// Κοινά στοιχεία, ίδια εμφάνιση με το Gelato System (κουμπιά, κάρτες, ετικέτες). Όλα server components.
import type { ComponentProps, ReactNode } from "react";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const BTN =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const VARIANT = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  success: "bg-success text-success-foreground hover:bg-success/90",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  outline: "border border-border bg-card shadow-xs hover:bg-secondary hover:text-secondary-foreground",
  ghost: "hover:bg-secondary hover:text-secondary-foreground",
};
const SIZE = {
  default: "h-9 px-3.5 pointer-coarse:min-h-11",
  sm: "h-7.5 rounded-lg px-2.5 text-xs pointer-coarse:min-h-11 pointer-coarse:min-w-11",
  lg: "h-12 px-6 text-lg",
};

export const btn = (variant: keyof typeof VARIANT = "default", size: keyof typeof SIZE = "default", extra?: string) =>
  cn(BTN, VARIANT[variant], SIZE[size], extra);

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-card)]", className)} {...p} />;
}

const TONE = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success/12 text-success-ink",
  warning: "bg-gold/18 text-gold-ink",
  danger: "bg-destructive/15 text-destructive",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-semibold", TONE[tone])}>{children}</span>;
}

/** Κεφαλίδα σελίδας + περιεχόμενο, όπως το AppLayout του Gelato System. */
export function Page({ section, title, description, actions, children }: { section: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 max-lg:pl-16 lg:px-8 print:hidden">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground lg:text-xs">{section} › {title}</p>
          <h1 className="truncate text-xl leading-tight lg:text-2xl">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      <main className="flex-1 px-4 pt-6 pb-[calc(var(--bottom-nav-h,0px)+1.5rem)] lg:px-8 print:p-0">{children}</main>
    </>
  );
}

const FIELD = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";
/** Πεδίο φόρμας με ορατή ετικέτα και προαιρετική βοήθεια από κάτω. */
export function Field({ label, hint, ...p }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block min-w-0 space-y-1 text-sm font-medium">
      {label}{p.required ? <span className="text-destructive"> *</span> : null}
      <input className={FIELD} {...p} />
      {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
export function Select({ label, options, ...p }: { label: string; options: [value: string, text: string][] } & ComponentProps<"select">) {
  return (
    <label className="block min-w-0 space-y-1 text-sm font-medium">
      {label}
      <select className={FIELD} {...p}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
    </label>
  );
}

/** Στοιχείο μενού γραμμής πίνακα (σύνδεσμος ή κουμπί φόρμας). */
export const menuItem = "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-secondary [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
