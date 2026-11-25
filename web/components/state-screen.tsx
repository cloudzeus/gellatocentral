import { Link2Off, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AuthCard } from "./auth-card";

// Χρώμα με νόημα, μόνο στο πλακίδιο του εικονιδίου: κόκκινο = κάτι χάλασε, ουδέτερο = δεν χάλασε τίποτα, πορτοκαλί = έληξε.
const TILE = {
  error: "bg-destructive/12 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
  expired: "bg-warning/22 text-warning-ink",
};

/** Το κοινό περιεχόμενο των οθονών σφάλματος και «δεν βρέθηκε». Το πλαίσιο (Card ή AuthCard) το βάζει ο καλών. */
export function StateScreen({ tone, icon: Icon, title, heading: Heading = "h2", children, actions, next, digest, footer }: {
  tone: keyof typeof TILE;
  icon: LucideIcon;
  title: string;
  heading?: "h1" | "h2";
  children: ReactNode;
  actions?: ReactNode;
  /** Πλαίσιο «Τι κάνεις τώρα», για επισκέπτη χωρίς λογαριασμό. */
  next?: string;
  /** Μόνο το error.digest: ποτέ μήνυμα ή stack. */
  digest?: string;
  footer?: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className="text-center">
      <span className={cn("mx-auto mb-3 grid size-12 place-items-center rounded-xl", TILE[tone])}><Icon className="size-6" aria-hidden /></span>
      <Heading className="text-xl font-semibold">{title}</Heading>
      <p className="mt-2 text-base text-muted-foreground">{children}</p>
      {next ? (
        <div className="mt-4 rounded-lg bg-warning/14 px-4 py-3 text-left text-sm">
          <p className="font-semibold text-warning-ink">Τι κάνεις τώρα</p>
          <p className="mt-1">{next}</p>
        </div>
      ) : null}
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2 max-sm:flex-col [&>*]:pointer-coarse:h-11 max-sm:[&>*]:w-full">{actions}</div> : null}
      {footer ? <p className="mt-4 text-sm text-muted-foreground">{footer}</p> : null}
      {digest ? <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">Κωδικός για την υποστήριξη: <b className="font-mono font-semibold text-foreground">{digest}</b></p> : null}
    </div>
  );
}

/** A4 · Δημόσιος σύνδεσμος με token που δεν ισχύει: ο επισκέπτης δεν έχει λογαριασμό, άρα κανένα κουμπί προς την εφαρμογή. */
export function ExpiredLink({ title, children = "Μπορεί να έληξε, να αντικαταστάθηκε από νεότερο ή να μην αντιγράφηκε ολόκληρος." }: { title: string; children?: ReactNode }) {
  return (
    <AuthCard>
      <StateScreen tone="expired" icon={Link2Off} heading="h1" title={title} next="Ζήτα νέο σύνδεσμο από την επιχείρηση που σου τον έστειλε.">{children}</StateScreen>
    </AuthCard>
  );
}
