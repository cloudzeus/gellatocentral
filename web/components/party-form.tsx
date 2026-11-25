"use client";
// Η φόρμα συναλλασσόμενου παραμένει UI-only client component: η αποθήκευση, το RBAC,
// το orgId και όλοι οι έλεγχοι εκτελούνται στην υπάρχουσα Server Action.
import { CircleAlert, CircleCheck, LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DB_INT_MAX, PARTY_ROLES, VIBER_SUBSCRIBER_ID_MAX, WEEKDAYS, type PartyRole } from "@/lib/parties";
import { AddressField } from "./address-field";
import { FormPending } from "./form-pending";
import { FormSection } from "./form-section";
import { GeoCascade, type GeoCascadeInitial } from "./geo-fields";
import { PartyMap } from "./party-map";
import { Alert, AlertDescription, AlertTitle } from "./shadcn/alert";
import { Button } from "./shadcn/button";
import { Checkbox } from "./shadcn/checkbox";
import { Label } from "./shadcn/label";
import { Progress } from "./shadcn/progress";
import { Submit } from "./submit";
import { btn, cn, Field, Select, TextareaField } from "./ui";

export type PartyValues = {
  id: string; roles: string[]; name: string; tradeName: string | null; countryCode: string; vatNumber: string | null;
  taxOffice: string | null; profession: string | null; contactName: string | null; email: string | null; phone: string | null;
  website: string | null; address: string | null; city: string | null; postalCode: string | null; region: string | null;
  latitude: number | null; longitude: number | null; paymentTermsDays: number | null; creditLimitCents: number | null;
  leadTimeDays: number | null; orderDays: number[]; deliveryDays: number[]; minOrderValueCents: number | null;
  paymentMethodId: string | null; notes: string | null; viberSubscriberId: string | null;
};
export type PartyRefs = { countries: [string, string][]; methods: [string, string][]; terms: [string, string][] };
const euroInput = (cents: number | null | undefined) => cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
type Lookup = { ok: boolean; message: string | null; source: string | null; fields: Record<string, string>; consultationNumber: string | null; cached?: boolean };

const STEPS = [
  { key: "registry", short: "Μητρώο", title: "Στοιχεία μητρώου και ρόλοι", description: "Βρες την επιχείρηση από το ΑΦΜ και δήλωσε πώς συνεργάζεσαι" },
  { key: "contact", short: "Επικοινωνία", title: "Επικοινωνία", description: "Τα κύρια στοιχεία για παραστατικά και καθημερινή επαφή" },
  { key: "address", short: "Διεύθυνση", title: "Έδρα και τοποθεσία", description: "Διάλεξε διεύθυνση από τις προτάσεις ή συμπλήρωσε τα πεδία με το χέρι" },
  { key: "finish", short: "Ολοκλήρωση", title: "Πληρωμές και σημειώσεις", description: "Προαιρετικοί όροι συνεργασίας και εσωτερικές σημειώσεις" },
] as const;

export function PartyForm({ action, party, refs, geo, defaultRole }: { action: (form: FormData) => Promise<void>; party?: PartyValues; refs: PartyRefs; geo?: GeoCascadeInitial; defaultRole?: PartyRole }) {
  const form = useRef<HTMLFormElement>(null);
  const formId = useId().replace(/:/g, "");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Lookup | null>(null);
  const [checkedFor, setCheckedFor] = useState("");
  // η χώρα κρατιέται σε state: για Ελλάδα τα γεωγραφικά πεδία είναι ο Καλλικράτης, αλλιώς ελεύθερο κείμενο
  const [country, setCountry] = useState(party?.countryCode ?? "GR");
  const v = (k: keyof PartyValues) => String(party?.[k] ?? "");
  const coord = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
  const el = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | null;
  const sectionId = (key: string) => `${formId}-${key}`;

  // Ο οδηγός ακολουθεί και το scroll, όχι μόνο τα κλικ στα βήματα.
  useEffect(() => {
    const root = form.current?.closest("[data-slot='dialog-content']") ?? null;
    const observer = new IntersectionObserver((entries) => {
      const current = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (current) setActive(STEPS.findIndex((s) => sectionId(s.key) === current.target.id));
    }, { root, rootMargin: "-15% 0px -65% 0px", threshold: 0 });
    for (const step of STEPS) {
      const section = document.getElementById(sectionId(step.key));
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(index: number) {
    setActive(index);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(sectionId(STEPS[index].key))?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  async function lookup() {
    const country = el("countryCode")?.value ?? "GR", vat = (el("vatNumber")?.value ?? "").trim();
    if (!vat) return setFound({ ok: false, message: "Γράψε πρώτα το ΑΦΜ", source: null, fields: {}, consultationNumber: null });
    setBusy(true);
    const r: Lookup = await fetch(`/api/vat-lookup?country=${encodeURIComponent(country)}&vat=${encodeURIComponent(vat)}`).then((x) => x.json()).catch(() => ({ ok: false, message: "Η αναζήτηση δεν ολοκληρώθηκε. Δοκίμασε ξανά ή συμπλήρωσε με το χέρι", source: null, fields: {}, consultationNumber: null }));
    setBusy(false);
    setFound(r);
    // γεμίζουμε μόνο όσα έφερε το μητρώο· ό,τι έχει γράψει ο χρήστης σε άλλα πεδία μένει
    for (const [k, val] of Object.entries(r.fields ?? {})) { const input = el(k); if (input && val) input.value = val; }
    setCheckedFor(r.ok ? `${country.toUpperCase()}${vat.replace(/[\s.-]+/g, "").toUpperCase().replace(/^(EL|GR)(?=\d{9}$)/, "")}` : "");
  }

  return (
    <form ref={form} key={party ? JSON.stringify(party) : "new"} action={action} className="grid gap-5 sm:grid-cols-2">
      <input type="hidden" name="vatCheckedFor" value={checkedFor} />

      <nav aria-label="Βήματα φόρμας" className="space-y-2 sm:col-span-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Βήμα {active + 1} από {STEPS.length}</span>
          <span>{STEPS[active].title}</span>
        </div>
        <Progress value={((active + 1) / STEPS.length) * 100} aria-label={`Πρόοδος φόρμας: βήμα ${active + 1} από ${STEPS.length}`} className="h-1 bg-primary/10 [&>[data-slot=progress-indicator]]:bg-gold" />
        <ol className="grid grid-cols-4 gap-1">
          {STEPS.map((step, i) => (
            <li key={step.key}>
              <button type="button" onClick={() => goTo(i)} aria-current={active === i ? "step" : undefined} className={cn("flex min-h-11 w-full cursor-pointer flex-col items-start justify-center rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", active === i ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground")}>
                <span className="text-2xs opacity-75">{i + 1}</span><span>{step.short}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <FormSection id={sectionId("registry")} step={1} title={STEPS[0].title} description={STEPS[0].description}>
        <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
          <Select label="Χώρα" name="countryCode" value={country} onValueChange={setCountry} options={refs.countries} />
          <Field label="ΑΦΜ" name="vatNumber" maxLength={20} defaultValue={v("vatNumber")} autoComplete="off" hint="Ελληνικό: 9 ψηφία. Ιδιώτης χωρίς ΑΦΜ: άφησέ το κενό" />
          <Button type="button" variant="outline" onClick={lookup} disabled={busy} aria-busy={busy || undefined} className="sm:mb-5">
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Search aria-hidden />}{busy ? "Αναζήτηση…" : "Εύρεση στοιχείων"}
          </Button>
        </div>
        {found ? (
          <Alert role={found.ok ? "status" : "alert"} className={cn("sm:col-span-2", found.ok ? "border-success/25 bg-success/10 text-success-ink" : "border-gold/30 bg-gold/10")}>
            {found.ok ? <CircleCheck aria-hidden /> : <CircleAlert className="text-gold-ink" aria-hidden />}
            <AlertTitle>{found.ok ? `Βρέθηκε${found.source ? ` (${found.source})` : ""}` : "Η αναζήτηση δεν ολοκληρώθηκε"}</AlertTitle>
            <AlertDescription className={found.ok ? "text-success-ink" : "text-foreground"}>
              {found.ok ? `Συμπληρώθηκαν όσα έδωσε το μητρώο. Έλεγξέ τα και άλλαξε ό,τι χρειάζεται${found.consultationNumber ? ` · αριθμός ελέγχου ${found.consultationNumber}` : ""}${found.cached ? " · από έλεγχο των τελευταίων 30 ημερών" : ""}${found.message ? ` · ${found.message}` : ""}` : found.message}
            </AlertDescription>
          </Alert>
        ) : null}
        <Field label="Επωνυμία ή ονοματεπώνυμο" name="name" required minLength={2} maxLength={160} defaultValue={v("name")} />
        <Field label="Διακριτικός τίτλος" name="tradeName" maxLength={160} defaultValue={v("tradeName")} hint="Όπως είναι γνωστό το κατάστημα" />
        <Field label="ΔΟΥ" name="taxOffice" maxLength={80} defaultValue={v("taxOffice")} />
        <Field label="Δραστηριότητα" name="profession" maxLength={160} defaultValue={v("profession")} />
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold">Τι είναι για εσένα <span className="text-destructive">*</span></legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(Object.keys(PARTY_ROLES) as PartyRole[]).map((r) => {
              const id = `${formId}-role-${r}`;
              return (
                <div key={r} className="flex min-h-14 items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:bg-secondary">
                  <Checkbox id={id} name="roles" value={r} defaultChecked={party ? party.roles.includes(r) : r === (defaultRole ?? "customer")} className="mt-0.5 cursor-pointer" />
                  <Label htmlFor={id} className="cursor-pointer flex-col items-start gap-0.5 leading-normal"><span className="font-semibold">{PARTY_ROLES[r].label}</span><span className="text-xs font-normal text-muted-foreground">{PARTY_ROLES[r].hint}</span></Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      </FormSection>

      <FormSection id={sectionId("contact")} step={2} title={STEPS[1].title} description={STEPS[1].description}>
        <Field label="Υπεύθυνος επικοινωνίας" name="contactName" maxLength={120} defaultValue={v("contactName")} />
        <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={v("phone")} />
        <Field label="Email" name="email" type="email" maxLength={160} defaultValue={v("email")} hint="Εδώ θα στέλνονται τα παραστατικά" />
        <Field label="Viber subscriber ID" name="viberSubscriberId" minLength={4} maxLength={VIBER_SUBSCRIBER_ID_MAX} autoComplete="off" spellCheck={false} defaultValue={v("viberSubscriberId")} hint="Προαιρετικό· το ID συνδρομητή από το Viber Bot, όχι τηλέφωνο. Άδειο για αφαίρεση" />
        <Field label="Ιστοσελίδα" name="website" maxLength={160} defaultValue={v("website")} />
      </FormSection>

      <FormSection id={sectionId("address")} step={3} title={STEPS[2].title} description={STEPS[2].description}>
        <AddressField label="Διεύθυνση έδρας" name="address" maxLength={200} defaultValue={v("address")} />
        <Field label="Τ.Κ." name="postalCode" maxLength={10} defaultValue={v("postalCode")} />
        <GeoCascade country={country} initial={geo} />
        <div className="grid grid-cols-2 gap-4"><Field label="Γεωγρ. πλάτος" name="latitude" inputMode="decimal" defaultValue={coord(party?.latitude)} placeholder="37,9838" /><Field label="Γεωγρ. μήκος" name="longitude" inputMode="decimal" defaultValue={coord(party?.longitude)} placeholder="23,7275" /></div>
        <details className="sm:col-span-2">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Τοποθέτηση στον χάρτη</summary>
          <p className="mt-1 text-xs text-muted-foreground">Πάτα στο σημείο της έδρας και γεμίζουν οι συντεταγμένες. Μπορείς και να τις αφήσεις κενές: βρίσκονται από τη διεύθυνση με ένα κουμπί στην καρτέλα</p>
          <div className="mt-2"><PartyMap pick={{ lat: "latitude", lng: "longitude" }} points={party?.latitude != null && party.longitude != null ? [{ latitude: party.latitude, longitude: party.longitude, label: "Έδρα", primary: true }] : []} /></div>
        </details>
      </FormSection>

      <FormSection id={sectionId("finish")} step={4} title={STEPS[3].title} description={STEPS[3].description}>
        <Select label="Όροι πληρωμής" name="paymentTermsDays" defaultValue={v("paymentTermsDays")} options={[["", "Δεν έχουν οριστεί"], ...refs.terms]} />
        <Select label="Τρόπος πληρωμής" name="paymentMethodId" defaultValue={v("paymentMethodId")} options={[["", "Δεν έχει οριστεί"], ...refs.methods]} />
        <Field label="Πιστωτικό όριο (€)" name="creditLimitCents" inputMode="decimal" maxLength={16} autoComplete="off" defaultValue={euroInput(party?.creditLimitCents)} placeholder="0,00" hint="Προαιρετικό εμπορικό στοιχείο, με το πολύ δύο δεκαδικά" />
        <Field label="Ελάχιστη αξία παραγγελίας (€)" name="minOrderValueCents" inputMode="decimal" maxLength={16} autoComplete="off" defaultValue={euroInput(party?.minOrderValueCents)} placeholder="0,00" hint="Προαιρετικό εμπορικό στοιχείο, με το πολύ δύο δεκαδικά" />
        <Field label="Ημέρες προετοιμασίας παραγγελίας" name="leadTimeDays" type="number" min={0} max={DB_INT_MAX} step={1} defaultValue={v("leadTimeDays")} />
        {(["orderDays", "deliveryDays"] as const).map((name) => (
          <fieldset key={name} className="sm:col-span-2">
            <legend className="text-sm font-semibold">{name === "orderDays" ? "Ημέρες παραγγελίας" : "Ημέρες παράδοσης"}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAYS.map((day) => {
                const id = `${formId}-${name}-${day.value}`;
                return <div key={day.value} className="flex min-h-11 items-center gap-2 rounded-lg border border-border/70 px-3 py-2"><Checkbox id={id} name={name} value={day.value} defaultChecked={party?.[name].includes(day.value)} /><Label htmlFor={id} className="cursor-pointer text-sm font-normal">{day.label}</Label></div>;
              })}
            </div>
          </fieldset>
        ))}
        <div className="sm:col-span-2"><TextareaField label="Σημειώσεις" name="notes" rows={3} maxLength={1000} defaultValue={v("notes")} hint="Εσωτερικές πληροφορίες για τη συνεργασία — δεν εκτυπώνονται" /></div>
      </FormSection>

      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur sm:col-span-2 sm:-mx-5 sm:-mb-5 sm:px-5">
        <FormPending label="Αποθήκευση στον server…" className="mb-2" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{STEPS[active].short} · {active + 1}/{STEPS.length}</span>
          <Submit pendingText="Αποθήκευση…" className={btn("default")}>{party ? "Αποθήκευση" : "Προσθήκη συναλλασσόμενου"}</Submit>
        </div>
      </div>
    </form>
  );
}
