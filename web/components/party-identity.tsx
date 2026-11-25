import type { ReactNode } from "react";
import { Building2, CheckCircle2, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { RoleBadges } from "@/components/party-bits";
import { Card } from "@/components/ui";
import { channelHref, showPhone } from "@/lib/crm";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

export type PartyIdentityProps = {
  name: string;
  tradeName: string | null;
  roles: string[];
  active: boolean;
  vatNumber: string | null;
  countryCode: string;
  taxOffice: string | null;
  profession: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  payment: string | null;
  notes: string | null;
  verifiedAt: string | null;
  complete: boolean;
  actions?: ReactNode;
};

/** Κεντρική ταυτότητα συναλλασσόμενου: server-rendered, πλήρες όνομα και στοιχεία χωρίς αποκοπές. */
export function PartyIdentity(p: PartyIdentityProps) {
  const fullAddress = [p.address, [p.postalCode, p.city].filter(Boolean).join(" "), p.region].filter(Boolean).join(", ");
  const websiteHref = p.website ? (/^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`) : null;
  const facts = [
    { label: "ΑΦΜ", value: p.vatNumber ? `${p.countryCode === "GR" ? "" : `${p.countryCode} `}${p.vatNumber}` : null },
    { label: "ΔΟΥ", value: p.taxOffice },
    { label: "Δραστηριότητα", value: p.profession },
    { label: "Πληρωμή", value: p.payment },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="min-w-0 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden><Building2 className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><RoleBadges roles={p.roles} /><StatusBadge look={look(p.active ? "success" : "neutral", p.active ? "Ενεργός" : "Ανενεργός")} /></div>
            <h2 className="mt-1.5 break-words text-base font-semibold leading-snug sm:text-lg">{p.name}</h2>
            {p.tradeName ? <p className="mt-1 break-words text-sm text-muted-foreground">Διακριτικός τίτλος: <span className="font-medium text-foreground">{p.tradeName}</span></p> : null}
          </div>
          {p.actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">{p.actions}</div> : null}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => <div key={fact.label} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt><dd className="mt-1 break-words text-sm font-semibold">{fact.value ?? <span className="font-normal text-muted-foreground">Δεν έχει συμπληρωθεί</span>}</dd></div>)}
        </dl>

        <div className="mt-4 grid gap-3 border-t border-border/70 pt-3 text-sm md:grid-cols-2">
          <div className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Έδρα</p><p className="mt-0.5 break-words leading-relaxed">{fullAddress || "Δεν έχει συμπληρωθεί διεύθυνση"}</p></div></div>
          <div className="flex min-w-0 flex-wrap content-start items-center gap-x-4 gap-y-2">
            {p.phone ? <a href={channelHref("phone", p.phone)} className="inline-flex min-h-8 max-w-full items-center gap-2 break-all font-medium underline-offset-4 hover:underline"><Phone className="size-4 shrink-0 text-muted-foreground" />{showPhone(p.phone)}</a> : null}
            {p.email ? <a href={channelHref("email", p.email)} className="inline-flex min-h-8 max-w-full items-center gap-2 break-all font-medium underline-offset-4 hover:underline"><Mail className="size-4 shrink-0 text-muted-foreground" />{p.email}</a> : null}
            {p.website && websiteHref ? <a href={websiteHref} target="_blank" rel="noreferrer" className="inline-flex min-h-8 max-w-full items-center gap-2 break-all font-medium underline-offset-4 hover:underline"><ExternalLink className="size-4 shrink-0 text-muted-foreground" />{p.website}</a> : null}
            {!p.phone && !p.email && !p.website ? <span className="text-muted-foreground">Δεν υπάρχουν στοιχεία άμεσης επικοινωνίας</span> : null}
          </div>
        </div>
        {p.notes ? <p className="mt-3 whitespace-pre-wrap break-words border-t border-border/70 pt-3 text-sm leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Σημειώσεις: </span>{p.notes}</p> : null}
        <p className={`mt-3 flex items-start gap-2 text-xs ${p.complete ? "text-success-ink" : "text-gold-ink"}`}><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />{p.complete ? `Πλήρη βασικά στοιχεία τιμολόγησης${p.verifiedAt ? ` · επαλήθευση μητρώου ${p.verifiedAt}` : ""}` : "Λείπουν βασικά στοιχεία τιμολόγησης · άνοιγμα στοιχείων για συμπλήρωση"}</p>
      </div>
    </Card>
  );
}
