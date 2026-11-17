import { Building2, Download, Landmark, MapPin, Pencil, Plus, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Files } from "@/components/files";
import { Modal } from "@/components/modal";
import { RoleBadges } from "@/components/party-bits";
import { PartyForm } from "@/components/party-form";
import { PartyMap, type MapPoint } from "@/components/party-map";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { consentsOf } from "@/lib/gdpr";
import { currentConsents, daysLeft, DUE_DAYS, PURPOSES } from "@/lib/gdpr/rules";
import { ADDRESS_KINDS, type AddressKind, distanceKm, roleText, showIban } from "@/lib/parties";
import { partyScope } from "@/lib/party-scope";
import { partyRefs } from "@/lib/refs";
import { deleteAddress, deleteBank, deleteContact, locateParty, requestCustomerErasure, saveAddress, saveBank, saveContact, saveParty, setCustomerConsent, setPrimaryBank } from "../actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "long", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { "1": "Τα στοιχεία αποθηκεύτηκαν", address: "Οι διευθύνσεις ενημερώθηκαν", contact: "Οι επαφές ενημερώθηκαν", bank: "Οι τραπεζικοί λογαριασμοί ενημερώθηκαν", located: "Η έδρα βρέθηκε στον χάρτη από τη διεύθυνσή της. Έλεγξε ότι η πινέζα είναι στο σωστό σημείο", consent: "Η συναίνεση καταγράφηκε", erasure: `Το αίτημα διαγραφής καταχωρίστηκε. Απάντηση μέσα σε ${DUE_DAYS} ημέρες` };
const sub = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";
const coordText = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `${lat.toFixed(4).replace(".", ",")} · ${lng.toFixed(4).replace(".", ",")}` : null);
const KIND_OPTIONS = Object.entries(ADDRESS_KINDS) as [string, string][];

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await partyScope();
  const party = await db.party.findFirst({ where: { id: (await params).id, orgId: scope.orgId }, include: { addresses: { orderBy: [{ branchNo: "asc" }, { label: "asc" }] }, contacts: { orderBy: { name: "asc" }, include: { address: true } }, bankAccounts: { orderBy: [{ isPrimary: "desc" }, { bank: "asc" }] }, linkedOrg: { select: { id: true } } } });
  if (!party) notFound();
  const q = await searchParams;
  const refs = await partyRefs();
  const tenant = scope.orgId ? await currentOrg("customers.manage") : null;
  const [consents, request, stores] = tenant
    ? await Promise.all([consentsOf("customer", party.id), db.erasureRequest.findFirst({ where: { orgId: tenant.org.id, subjectType: "customer", subjectId: party.id, status: "PENDING" } }), db.store.findMany({ where: { orgId: tenant.org.id, active: true, latitude: { not: null }, longitude: { not: null } } })])
    : [[], null, []];
  const marketing = currentConsents(consents).get("customer_marketing");
  const method = refs.methods.find(([c]) => c === party.paymentMethod)?.[1];
  const facts: [string, string | null][] = [
    ["ΑΦΜ", party.vatNumber ? `${party.countryCode === "GR" ? "" : `${party.countryCode} `}${party.vatNumber}` : null], ["ΔΟΥ", party.taxOffice], ["Δραστηριότητα", party.profession],
    ["Υπεύθυνος επικοινωνίας", party.contactName], ["Email", party.email], ["Τηλέφωνο", party.phone],
    ["Έδρα", [party.address, party.postalCode, party.city].filter(Boolean).join(", ") || null], ["Περιοχή", party.region], ["Ιστοσελίδα", party.website],
    ["Όροι πληρωμής", party.paymentTermsDays != null ? (party.paymentTermsDays ? `${party.paymentTermsDays} ημέρες` : "Μετρητοίς") : null], ["Τρόπος πληρωμής", method ?? null], ["Στο αρχείο από", day.format(party.createdAt)],
  ];
  const missing = [!party.vatNumber && "ΑΦΜ", !party.email && "email", !party.address && "διεύθυνση"].filter(Boolean);
  const hq = party.latitude != null && party.longitude != null ? { latitude: party.latitude, longitude: party.longitude } : null;
  const points: MapPoint[] = [...(hq ? [{ ...hq, label: "Έδρα", primary: true }] : []), ...party.addresses.flatMap((a) => (a.latitude != null && a.longitude != null ? [{ latitude: a.latitude, longitude: a.longitude, label: a.label ?? ADDRESS_KINDS[a.kind as AddressKind] ?? "Διεύθυνση" }] : []))];
  const placeCount = 1 + party.addresses.length;
  // το πιο κοντινό δικό μας κατάστημα στην έδρα του (σε ευθεία)
  const nearest = hq && stores.length ? stores.map((s) => ({ name: s.name, km: distanceKm(hq, { latitude: s.latitude!, longitude: s.longitude! }) })).sort((a, b) => a.km - b.km)[0] : null;
  const addressOptions: [string, string][] = [["", "Στην έδρα"], ...party.addresses.map((a): [string, string] => [a.id, a.label ?? `${ADDRESS_KINDS[a.kind as AddressKind]} · ${a.city ?? a.street}`])];

  // συναρτήσεις που επιστρέφουν τη φόρμα (όχι components: ορίζονται μέσα στη σελίδα για να βλέπουν τον συναλλασσόμενο)
  const addressForm = (a?: (typeof party.addresses)[number]) => (
    <form key={a ? JSON.stringify(a) : "new"} action={saveAddress.bind(null, party.id, a?.id ?? null)} className={sub}>
      <Select label="Είδος" name="kind" defaultValue={a?.kind ?? "branch"} options={KIND_OPTIONS} />
      <Field label="Αριθμός εγκατάστασης" name="branchNo" type="number" min={1} max={9999} defaultValue={a?.branchNo ?? ""} hint="Μόνο για υποκατάστημα: όπως είναι δηλωμένο στην εφορία (η έδρα είναι 0)" />
      <Field label="Ονομασία" name="label" maxLength={80} defaultValue={a?.label ?? ""} placeholder="π.χ. Κατάστημα Γλυφάδας" />
      <Field label="Διεύθυνση" name="street" required minLength={2} maxLength={200} defaultValue={a?.street ?? ""} />
      <div className="grid grid-cols-[7rem_1fr] gap-4"><Field label="Τ.Κ." name="postalCode" maxLength={10} defaultValue={a?.postalCode ?? ""} /><Field label="Πόλη" name="city" maxLength={80} defaultValue={a?.city ?? ""} /></div>
      <label className="block min-w-0 space-y-1 text-sm font-medium">Περιοχή<input name="region" list="address-regions" maxLength={80} defaultValue={a?.region ?? ""} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11" /><datalist id="address-regions">{refs.regions.map((r) => <option key={r} value={r} />)}</datalist></label>
      <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={a?.phone ?? ""} />
      <Field label="Email" name="email" type="email" maxLength={160} defaultValue={a?.email ?? ""} />
      <div className="grid grid-cols-2 gap-4"><Field label="Γεωγρ. πλάτος" name="latitude" inputMode="decimal" defaultValue={a?.latitude != null ? String(a.latitude).replace(".", ",") : ""} /><Field label="Γεωγρ. μήκος" name="longitude" inputMode="decimal" defaultValue={a?.longitude != null ? String(a.longitude).replace(".", ",") : ""} /></div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="locate" defaultChecked={!a} className="size-4 accent-[var(--primary)]" /> Αν δεν γράψω συντεταγμένες, βρες τες από τη διεύθυνση</label>
      <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">Τοποθέτηση στον χάρτη</summary><div className="mt-2"><PartyMap pick={{ lat: "latitude", lng: "longitude" }} points={a?.latitude != null && a.longitude != null ? [{ latitude: a.latitude, longitude: a.longitude, label: a.label ?? "Σημείο", primary: true }] : hq ? [{ ...hq, label: "Έδρα" }] : []} /></div></details>
      <div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" maxLength={300} defaultValue={a?.notes ?? ""} placeholder="π.χ. ώρες παραλαβής" /></div>
      <Submit className={btn("default")}>{a ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );
  const contactForm = (c?: (typeof party.contacts)[number]) => (
    <form key={c ? JSON.stringify({ ...c, address: null }) : "new"} action={saveContact.bind(null, party.id, c?.id ?? null)} className={sub}>
      <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={120} defaultValue={c?.name ?? ""} />
      <Field label="Ιδιότητα" name="title" maxLength={80} defaultValue={c?.title ?? ""} placeholder="π.χ. Λογιστήριο" />
      <Field label="Email" name="email" type="email" maxLength={160} defaultValue={c?.email ?? ""} />
      <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={c?.phone ?? ""} />
      <Select label="Πού βρίσκεται" name="addressId" defaultValue={c?.addressId ?? ""} options={addressOptions} />
      <Field label="Σημειώσεις" name="notes" maxLength={300} defaultValue={c?.notes ?? ""} />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section={`${scope.section} › Συναλλασσόμενοι`} title={party.name} description={[party.tradeName, party.city, roleText(party.roles)].filter(Boolean).join(" · ")}
      actions={<><RoleBadges roles={party.roles} /><Badge tone={party.active ? "success" : "neutral"}>{party.active ? "Ενεργός" : "Ανενεργός"}</Badge>{party.linkedOrg ? <Link href={`/platform/${party.linkedOrg.id}`} className={btn("outline")}>Σελίδα συνδρομητή</Link> : null}<Link href={scope.base} className={btn("outline")}>Όλοι</Link></>}>
      <div className="grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
          {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 220)}</p> : null}

          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 basis-56 flex-1">
                <h2 className="text-lg">Στοιχεία {party.vatCheckedAt ? <Badge tone="success">Επιβεβαιώθηκαν από το μητρώο {day.format(party.vatCheckedAt)}</Badge> : null}</h2>
                <p className="text-sm text-muted-foreground">{missing.length ? `Για τιμολόγιο λείπουν: ${missing.join(", ")}` : "Τα στοιχεία τιμολόγησης είναι πλήρη"}</p>
              </div>
              {scope.canEdit ? <Modal label={<><Pencil /> Αλλαγή</>} title="Στοιχεία συναλλασσόμενου"><PartyForm action={saveParty.bind(null, party.id)} party={party} refs={refs} /></Modal> : null}
            </div>
            <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {facts.map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="font-semibold break-words">{v ?? <span className="font-normal text-muted-foreground">Δεν έχει συμπληρωθεί</span>}</dd></div>)}
            </dl>
            {party.notes ? <p className="border-t border-border px-5 py-4 text-muted-foreground"><span className="font-medium text-foreground">Σημειώσεις:</span> {party.notes}</p> : null}
          </Card>

          <Card id="addresses" className="scroll-mt-28">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 basis-56 flex-1"><h2 className="text-lg">Υποκαταστήματα και διευθύνσεις</h2><p className="text-sm text-muted-foreground">Κάθε υποκατάστημα με τον αριθμό εγκατάστασής του, και οι διευθύνσεις παράδοσης ή τιμολόγησης</p></div>
              {scope.canEdit ? <Modal label={<><Plus /> Προσθήκη</>} title="Νέο υποκατάστημα ή διεύθυνση">{addressForm()}</Modal> : null}
            </div>
            <ul className="divide-y divide-border">
              <li className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/10 text-success-ink"><Building2 className="size-4" /></span>
                <div className="min-w-0 basis-56 flex-1"><p className="font-semibold">Έδρα <Badge>Εγκατάσταση 0</Badge></p><p className="text-sm text-muted-foreground">{[party.address, party.postalCode, party.city, party.region].filter(Boolean).join(", ") || "Δεν έχει συμπληρωθεί διεύθυνση"}{hq ? ` · ${coordText(party.latitude, party.longitude)}` : ""}</p></div>
                {!hq && party.address && scope.canEdit ? <form action={locateParty.bind(null, party.id)}><Submit className={btn("outline", "sm")}><MapPin /> Εύρεση στον χάρτη</Submit></form> : null}
              </li>
              {party.addresses.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${a.kind === "branch" ? "bg-success/10 text-success-ink" : "bg-gold/15 text-gold-ink"}`}>{a.kind === "branch" ? <Building2 className="size-4" /> : <Truck className="size-4" />}</span>
                  <div className="min-w-0 basis-56 flex-1">
                    <p className="font-semibold">{a.label ?? ADDRESS_KINDS[a.kind as AddressKind]} {a.branchNo ? <Badge>Εγκατάσταση {a.branchNo}</Badge> : <Badge>{ADDRESS_KINDS[a.kind as AddressKind]}</Badge>}</p>
                    <p className="text-sm text-muted-foreground">{[a.street, a.postalCode, a.city, a.region].filter(Boolean).join(", ")}{a.phone ? ` · ${a.phone}` : ""} · {coordText(a.latitude, a.longitude) ?? <b className="text-destructive">λείπουν συντεταγμένες</b>}</p>
                  </div>
                  {scope.canEdit ? <><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={a.label ?? "Διεύθυνση"}>{addressForm(a)}</Modal><form action={deleteAddress.bind(null, party.id, a.id)}><Submit aria-label={`Διαγραφή: ${a.label ?? a.street}`} className={btn("ghost", "sm")}><Trash2 /></Submit></form></> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card id="contacts" className="scroll-mt-28">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 basis-56 flex-1"><h2 className="text-lg">Επαφές</h2><p className="text-sm text-muted-foreground">Τα πρόσωπα με τα οποία μιλάς, και σε ποιο υποκατάστημα βρίσκεται το καθένα</p></div>
              {scope.canEdit ? <Modal label={<><Plus /> Προσθήκη</>} title="Νέα επαφή">{contactForm()}</Modal> : null}
            </div>
            {party.contacts.length ? (
              <ul className="divide-y divide-border">
                {party.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground" aria-hidden>{c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
                    <div className="min-w-0 basis-56 flex-1"><p className="font-semibold">{c.name}{c.title ? <span className="font-normal text-muted-foreground"> · {c.title}</span> : null}</p><p className="text-sm text-muted-foreground">{[c.email, c.phone, c.address ? (c.address.label ?? c.address.city ?? c.address.street) : "Έδρα"].filter(Boolean).join(" · ")}</p></div>
                    {scope.canEdit ? <><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={c.name}>{contactForm(c)}</Modal><form action={deleteContact.bind(null, party.id, c.id)}><Submit aria-label={`Διαγραφή επαφής: ${c.name}`} className={btn("ghost", "sm")}><Trash2 /></Submit></form></> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-sm text-muted-foreground">{party.contactName ? `Κύρια επαφή: ${party.contactName}. Πρόσθεσε εδώ και τα υπόλοιπα πρόσωπα` : "Καμία επαφή ακόμα"}</p>}
          </Card>

          {tenant ? (
            <Card>
              <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Έγγραφα</h2><p className="text-sm text-muted-foreground">Συμβάσεις, δικαιολογητικά, φωτογραφίες. Τα βλέπουν μόνο όσοι διαχειρίζονται συναλλασσόμενους</p></div>
              <div className="p-5"><Files orgId={tenant.org.id} category="customer_document" refType="customer" refId={party.id} empty="Κανένα έγγραφο ακόμα" /></div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card id="map" className="scroll-mt-28">
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Στον χάρτη</h2><p className="text-sm text-muted-foreground">{points.length} από {placeCount} σημεία έχουν θέση{nearest ? ` · πιο κοντινό δικό σου κατάστημα: ${nearest.name}, ${nearest.km < 10 ? nearest.km.toFixed(1).replace(".", ",") : Math.round(nearest.km)} χλμ από την έδρα` : ""}</p></div>
            <div className="p-5">{points.length ? <PartyMap points={points} /> : <p className="text-sm text-muted-foreground">Κανένα σημείο δεν έχει συντεταγμένες ακόμα. Πάτα «Εύρεση στον χάρτη» στην έδρα, ή βάλε την πινέζα από το «Αλλαγή»</p>}</div>
          </Card>

          <Card id="banks" className="scroll-mt-28">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1"><h2 className="text-lg">Τραπεζικοί λογαριασμοί</h2></div>
              {scope.canEdit ? (
                <Modal label={<><Plus /> Προσθήκη</>} size="sm" title="Νέος τραπεζικός λογαριασμός">
                  <form action={saveBank.bind(null, party.id)} className="grid gap-4 [&>button]:justify-self-end">
                    <Field label="IBAN" name="iban" required maxLength={42} autoComplete="off" placeholder="GR00 0000 0000 0000 0000 0000 000" hint="Ελέγχεται πριν αποθηκευτεί" />
                    <Field label="Τράπεζα" name="bank" maxLength={80} />
                    <Field label="Δικαιούχος" name="holder" maxLength={160} hint="Αν διαφέρει από την επωνυμία" />
                    <Submit className={btn("default")}>Προσθήκη</Submit>
                  </form>
                </Modal>
              ) : null}
            </div>
            {party.bankAccounts.length ? (
              <ul className="divide-y divide-border">
                {party.bankAccounts.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 basis-40 flex-1"><p className="font-semibold">{b.bank ?? "Τράπεζα"}{b.holder ? <span className="font-normal text-muted-foreground"> · {b.holder}</span> : null}</p><p className="font-mono text-xs text-muted-foreground">{showIban(b.iban)}</p></div>
                    {b.isPrimary ? <Badge tone="success">Κύριος</Badge> : scope.canEdit ? <form action={setPrimaryBank.bind(null, party.id, b.id)}><Submit className={btn("ghost", "sm")}>Ορισμός ως κύριου</Submit></form> : null}
                    {scope.canEdit ? <form action={deleteBank.bind(null, party.id, b.id)}><Submit aria-label={`Διαγραφή λογαριασμού ${b.bank ?? ""}`} className={btn("ghost", "sm")}><Trash2 /></Submit></form> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένας λογαριασμός ακόμα. Χρειάζεται για πληρωμές προμηθευτών</p>}
          </Card>

          {tenant ? (
            <Card id="gdpr" className="scroll-mt-28">
              <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Προσωπικά δεδομένα</h2><p className="text-sm text-muted-foreground">Τι έχει συμφωνήσει και τα δικαιώματά του</p></div>
              <ul className="divide-y divide-border">
                <li className="space-y-2 px-5 py-3">
                  <p className="font-medium">{PURPOSES.customer_marketing.label}</p>
                  <p className="text-sm text-muted-foreground">Καταχώρισε τη συναίνεση μόνο αν την έδωσε ρητά</p>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={marketing?.granted ? "success" : "neutral"}>{marketing?.granted ? `Ναι, από ${day.format(marketing.at)}` : marketing ? `Ανακλήθηκε ${day.format(marketing.at)}` : "Δεν έχει δοθεί"}</Badge><form action={setCustomerConsent.bind(null, party.id, !marketing?.granted)}><Submit className={btn("outline", "sm")}>{marketing?.granted ? "Ανάκληση" : "Καταχώριση συναίνεσης"}</Submit></form></div>
                </li>
                <li className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 basis-40 flex-1"><p className="font-medium">Αντίγραφο των δεδομένων του</p><p className="text-sm text-muted-foreground">Αν ζητήσει τι κρατάς για αυτόν</p></div>
                  <a href={`/api/customers/${party.id}/export`} download className={btn("outline", "sm")}><Download /> Λήψη</a>
                </li>
                <li className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 basis-40 flex-1"><p className="font-medium">Διαγραφή των δεδομένων του</p><p className="text-sm text-muted-foreground">{request ? `Ανοιχτό αίτημα από ${day.format(request.requestedAt)}. ${daysLeft(request.dueAt) >= 0 ? `Απομένουν ${daysLeft(request.dueAt)} ημέρες` : "Η προθεσμία πέρασε"}` : `Ανοίγει αίτημα με προθεσμία ${DUE_DAYS} ημερών`}</p></div>
                  {request ? (tenant.permissions.includes("gdpr.manage") ? <Link href="/gdpr" className={btn("outline", "sm")}>Στα αιτήματα</Link> : <Badge tone="warning">Σε εξέταση</Badge>) : (
                    <Modal label={<><Trash2 /> Αίτημα</>} size="sm" variant="outline" title="Αίτημα διαγραφής" description={`Το εξετάζει ο υπεύθυνος GDPR της επιχείρησης μέσα σε ${DUE_DAYS} ημέρες`}>
                      <form action={requestCustomerErasure.bind(null, party.id)} className="grid gap-4 [&>button]:justify-self-end">
                        <Field label="Πώς ήρθε το αίτημα" name="reason" maxLength={500} hint="π.χ. με email στις 12/11. Σβήνεται όταν ολοκληρωθεί" />
                        <Submit className={btn("default")}>Άνοιγμα αιτήματος</Submit>
                      </form>
                    </Modal>
                  )}
                </li>
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
