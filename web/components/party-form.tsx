"use client";
// Η φόρμα συναλλασσόμενου, ίδια για νέο και για αλλαγή. Το «Εύρεση στοιχείων» ρωτά το μητρώο (ΑΑΔΕ για Ελλάδα, VIES
// για την υπόλοιπη ΕΕ) και συμπληρώνει τα πεδία· ο χρήστης τα ελέγχει πριν αποθηκεύσει.
import { CircleAlert, CircleCheck, Search } from "lucide-react";
import { useRef, useState } from "react";
import { PARTY_ROLES, type PartyRole } from "@/lib/parties";
import { AddressField } from "./address-field";
import { GeoCascade, type GeoCascadeInitial } from "./geo-fields";
import { PartyMap } from "./party-map";
import { Submit } from "./submit";
import { btn, Field, Select } from "./ui";

export type PartyValues = { id: string; roles: string[]; name: string; tradeName: string | null; countryCode: string; vatNumber: string | null; taxOffice: string | null; profession: string | null; contactName: string | null; email: string | null; phone: string | null; website: string | null; address: string | null; city: string | null; postalCode: string | null; region: string | null; latitude: number | null; longitude: number | null; paymentTermsDays: number | null; paymentMethodId: string | null; notes: string | null };
export type PartyRefs = { countries: [string, string][]; methods: [string, string][]; terms: [string, string][] };
type Lookup = { ok: boolean; message: string | null; source: string | null; fields: Record<string, string>; consultationNumber: string | null; cached?: boolean };

export function PartyForm({ action, party, refs, geo, defaultRole }: { action: (form: FormData) => Promise<void>; party?: PartyValues; refs: PartyRefs; geo?: GeoCascadeInitial; defaultRole?: PartyRole }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Lookup | null>(null);
  const [checkedFor, setCheckedFor] = useState("");
  // η χώρα κρατιέται σε state: για Ελλάδα τα γεωγραφικά πεδία είναι ο Καλλικράτης, αλλιώς ελεύθερο κείμενο
  const [country, setCountry] = useState(party?.countryCode ?? "GR");
  const v = (k: keyof PartyValues) => String(party?.[k] ?? "");
  const coord = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
  const el = (name: string) => form.current?.elements.namedItem(name) as HTMLInputElement | null;

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
    <form ref={form} key={party ? JSON.stringify(party) : "new"} action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="vatCheckedFor" value={checkedFor} />
      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
        <Select label="Χώρα" name="countryCode" value={country} onChange={(e) => setCountry(e.target.value)} options={refs.countries} />
        <Field label="ΑΦΜ" name="vatNumber" maxLength={20} defaultValue={v("vatNumber")} autoComplete="off" hint="Ελληνικό: 9 ψηφία. Ιδιώτης χωρίς ΑΦΜ: άφησέ το κενό" />
        <button type="button" onClick={lookup} disabled={busy} aria-busy={busy || undefined} className={`${btn("outline")} sm:mb-5`}><Search /> {busy ? "Αναζήτηση…" : "Εύρεση στοιχείων"}</button>
      </div>
      {found ? (
        <p role={found.ok ? "status" : "alert"} className={`flex gap-2 rounded-lg px-3 py-2.5 text-sm sm:col-span-2 ${found.ok ? "bg-success/10 text-success-ink" : "bg-gold/10"}`}>
          {found.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />}
          <span>{found.ok ? <><b>Βρέθηκε{found.source ? ` (${found.source})` : ""}.</b> Συμπληρώθηκαν όσα έδωσε το μητρώο. Έλεγξέ τα και άλλαξε ό,τι χρειάζεται{found.consultationNumber ? ` · αριθμός ελέγχου ${found.consultationNumber}` : ""}{found.cached ? " · από έλεγχο των τελευταίων 30 ημερών" : ""}{found.message ? ` · ${found.message}` : ""}</> : found.message}</span>
        </p>
      ) : null}

      <Field label="Επωνυμία ή ονοματεπώνυμο" name="name" required minLength={2} maxLength={160} defaultValue={v("name")} />
      <Field label="Διακριτικός τίτλος" name="tradeName" maxLength={160} defaultValue={v("tradeName")} hint="Όπως είναι γνωστό το κατάστημα" />
      <Field label="ΔΟΥ" name="taxOffice" maxLength={80} defaultValue={v("taxOffice")} />
      <Field label="Δραστηριότητα" name="profession" maxLength={160} defaultValue={v("profession")} />

      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-semibold">Τι είναι για εσένα <span className="text-destructive">*</span></legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(PARTY_ROLES) as PartyRole[]).map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-2 hover:bg-secondary">
              <input type="checkbox" name="roles" value={r} defaultChecked={party ? party.roles.includes(r) : r === (defaultRole ?? "customer")} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span className="text-sm"><span className="font-semibold">{PARTY_ROLES[r].label}</span><span className="block text-xs text-muted-foreground">{PARTY_ROLES[r].hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Υπεύθυνος επικοινωνίας" name="contactName" maxLength={120} defaultValue={v("contactName")} />
      <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={v("phone")} />
      <Field label="Email" name="email" type="email" maxLength={160} defaultValue={v("email")} hint="Εδώ θα στέλνονται τα παραστατικά" />
      <Field label="Ιστοσελίδα" name="website" maxLength={160} defaultValue={v("website")} />

      <AddressField label="Διεύθυνση έδρας" name="address" maxLength={200} defaultValue={v("address")} />
      <Field label="Τ.Κ." name="postalCode" maxLength={10} defaultValue={v("postalCode")} />
      {/* αλληλοεξαρτώμενα γεωγραφικά: Περιφέρεια → Νομός → Δήμος → Πόλη → Περιοχή, με προτάσεις από τον χάρτη */}
      <GeoCascade country={country} initial={geo} />
      <div className="grid grid-cols-2 gap-4"><Field label="Γεωγρ. πλάτος" name="latitude" inputMode="decimal" defaultValue={coord(party?.latitude)} placeholder="37,9838" /><Field label="Γεωγρ. μήκος" name="longitude" inputMode="decimal" defaultValue={coord(party?.longitude)} placeholder="23,7275" /></div>
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-sm font-semibold">Τοποθέτηση στον χάρτη</summary>
        <p className="mt-1 text-xs text-muted-foreground">Πάτα στο σημείο της έδρας και γεμίζουν οι συντεταγμένες. Μπορείς και να τις αφήσεις κενές: βρίσκονται από τη διεύθυνση με ένα κουμπί στην καρτέλα</p>
        <div className="mt-2"><PartyMap pick={{ lat: "latitude", lng: "longitude" }} points={party?.latitude != null && party.longitude != null ? [{ latitude: party.latitude, longitude: party.longitude, label: "Έδρα", primary: true }] : []} /></div>
      </details>

      <Select label="Όροι πληρωμής" name="paymentTermsDays" defaultValue={v("paymentTermsDays")} options={[["", "Δεν έχουν οριστεί"], ...refs.terms]} />
      <Select label="Τρόπος πληρωμής" name="paymentMethodId" defaultValue={v("paymentMethodId")} options={[["", "Δεν έχει οριστεί"], ...refs.methods]} />
      <div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" maxLength={1000} defaultValue={v("notes")} /></div>
      {/* η φόρμα είναι μακριά: το κουμπί μένει πάντα ορατό στο κάτω μέρος του παραθύρου */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-border/70 bg-card px-5 py-3 sm:col-span-2">
        <Submit className={btn("default")}>{party ? "Αποθήκευση" : "Προσθήκη συναλλασσόμενου"}</Submit>
      </div>
    </form>
  );
}
