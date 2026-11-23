import { Building2, CalendarClock, Check, Download, Landmark, Mail, MapPin, PackageSearch, Pencil, Phone, Plus, ReceiptText, Star, Trash2, Truck, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressField } from "@/components/address-field";
import { ActivityForm } from "@/components/crm/activity-form";
import { QuickActions } from "@/components/crm/quick-actions";
import { Timeline } from "@/components/crm/timeline";
import { DataTable } from "@/components/data-table";
import { Files } from "@/components/files";
import { GeoCascade } from "@/components/geo-fields";
import { Modal } from "@/components/modal";
import { ACCOUNT_VIEWS, PartyAccount, PartyAccountSummary, type AccountView } from "@/components/party-account";
import { PartyIdentity } from "@/components/party-identity";
import { Checkbox } from "@/components/shadcn/checkbox";
import { PartyForm } from "@/components/party-form";
import { PartyMap, type MapPoint } from "@/components/party-map";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { ago, CHANNEL_LABELS, channelHref, contactTone, CONTACT_KINDS, dueText, initials, mergeTimeline, monthBuckets, showPhone, taskState, TIMELINE_FILTERS, type TimelineFilter } from "@/lib/crm";
import { partyEvents } from "@/lib/crm-data";
import { db } from "@/lib/db";
import { listDocTypes } from "@/lib/documents/registry";
import { consentsOf } from "@/lib/gdpr";
import { currentConsents, daysLeft, DUE_DAYS, PURPOSES } from "@/lib/gdpr/rules";
import { geoBreadcrumb, type GeoBreadcrumb } from "@/lib/geo";
import { euro } from "@/lib/money";
import { fiscalRequestDetails, summarizePartyAccount } from "@/lib/party-account";
import { ADDRESS_KINDS, type AddressKind, distanceKm, roleText, showIban } from "@/lib/parties";
import { partyScope } from "@/lib/party-scope";
import { calculatePurchaseDocument } from "@/lib/purchase-document";
import { resolvePrice } from "@/lib/purchase-pricing";
import { partyRefs } from "@/lib/refs";
import { ACTIVE as OPEN_TICKETS } from "@/lib/support/rules";
import { STATUS as SUBSCRIPTION } from "../../platform/status";
import { deleteAddress, deleteBank, deleteChannel, deleteContact, flagContact, locateParty, logActivity, primaryChannel, requestCustomerErasure, saveAddress, saveBank, saveChannel, saveContact, saveParty, setCustomerConsent, setPrimaryBank, touchActivity } from "../actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "long", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { "1": "Τα στοιχεία αποθηκεύτηκαν", address: "Οι διευθύνσεις ενημερώθηκαν", contact: "Οι επαφές ενημερώθηκαν", channel: "Τα τηλέφωνα και τα email ενημερώθηκαν", bank: "Οι τραπεζικοί λογαριασμοί ενημερώθηκαν", located: "Η έδρα βρέθηκε στον χάρτη από τη διεύθυνσή της. Έλεγξε ότι η πινέζα είναι στο σωστό σημείο", consent: "Η συναίνεση καταγράφηκε", erasure: `Το αίτημα διαγραφής καταχωρίστηκε. Απάντηση μέσα σε ${DUE_DAYS} ημέρες` };
const sub = "grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end";
const coordText = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `${lat.toFixed(4).replace(".", ",")} · ${lng.toFixed(4).replace(".", ",")}` : null);
const KIND_OPTIONS = Object.entries(ADDRESS_KINDS) as [string, string][];
const TABS = { overview: "Επισκόπηση", account: "Οικονομικά", transactions: "Είδη & αγορές", contacts: "Επαφές", places: "Διευθύνσεις & χάρτης", files: "Αρχεία", details: "Στοιχεία & τράπεζες" } as const;
const PURCHASE_STATUS = { DRAFT: { label: "Πρόχειρο", tone: "warning" }, POSTED: { label: "Καταχωρημένο", tone: "success" }, CANCELLED: { label: "Ακυρωμένο", tone: "neutral" } } as const;
type Tab = keyof typeof TABS;
const INPUT = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";
type Channel = { id: string; kind: string; value: string; label: string | null; isPrimary: boolean };

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await partyScope();
  const party = await db.party.findFirst({
    where: { id: (await params).id, orgId: scope.orgId },
    include: {
      // geoArea: το όνομα της περιοχής από την κοινή λίστα, για να εμφανίζεται προσυμπληρωμένο στις φόρμες
      geoArea: { select: { name: true } },
      addresses: { orderBy: [{ branchNo: "asc" }, { label: "asc" }], include: { geoArea: { select: { name: true } } } },
      contacts: { orderBy: [{ active: "desc" }, { isPrimary: "desc" }, { person: { name: "asc" } }], include: { address: true, person: { include: { channels: { orderBy: [{ isPrimary: "desc" }, { kind: "desc" }] }, links: { include: { party: { select: { id: true, name: true } } } } } } } },
      channels: { orderBy: [{ kind: "desc" }, { isPrimary: "desc" }, { id: "asc" }], include: { address: true } },
      bankAccounts: { orderBy: [{ isPrimary: "desc" }, { bank: "asc" }] },
      _count: { select: { purchaseDocs: true, supplierItems: true } },
      linkedOrg: { select: { id: true, subscription: { include: { plan: { select: { name: true } }, charges: { where: { paidAt: null } } } } } },
    },
  });
  if (!party) notFound();
  const q = await searchParams;
  const requestedTab: Tab = typeof q.tab === "string" && q.tab in TABS ? (q.tab as Tab) : "overview";
  const show: TimelineFilter = typeof q.show === "string" && q.show in TIMELINE_FILTERS ? (q.show as TimelineFilter) : "all";
  const now = new Date();
  const base = `${scope.base}/${party.id}`;
  const refs = await partyRefs();
  // Η αλυσίδα Καλλικράτη (Περιφέρεια → Νομός → Δήμος) της έδρας και κάθε διεύθυνσης με κωδικό,
  // ώστε τα αλληλοεξαρτώμενα πεδία των φορμών να ανοίγουν προσυμπληρωμένα
  const crumbs = new Map<string, GeoBreadcrumb>();
  await Promise.all(
    [...(party.regionCode ? [["hq", party.regionCode] as const] : []), ...party.addresses.flatMap((a) => (a.regionCode ? [[a.id, a.regionCode] as const] : []))].map(async ([key, code]) => {
      crumbs.set(key, await geoBreadcrumb(code));
    }),
  );
  const tenant = scope.orgId ? await currentOrg("parties.read") : null;
  const canSeePurchases = Boolean(scope.orgId && tenant?.permissions.includes("purchases.read"));
  const canSeeAccount = Boolean(scope.orgId && tenant?.permissions.includes("receipts.read"));
  const tab: Tab = (requestedTab === "transactions" && !canSeePurchases) || (requestedTab === "account" && !canSeeAccount) ? "overview" : requestedTab;
  const accountView: AccountView = typeof q.view === "string" && q.view in ACCOUNT_VIEWS ? q.view as AccountView : "ledger";
  const [consents, request, stores] = tenant
    ? await Promise.all([consentsOf("customer", party.id), db.erasureRequest.findFirst({ where: { orgId: tenant.org.id, subjectType: "customer", subjectId: party.id, status: "PENDING" } }), db.store.findMany({ where: { orgId: tenant.org.id, active: true, latitude: { not: null }, longitude: { not: null } } })])
    : [[], null, []];
  const [events, persons, openTickets, purchases, supplierItems] = await Promise.all([
    partyEvents(party),
    tab === "contacts" && scope.canEdit ? db.person.findMany({ where: { orgId: scope.orgId, links: { none: { partyId: party.id } } }, orderBy: { name: "asc" }, take: 300, include: { links: { take: 2, include: { party: { select: { name: true } } } } } }) : [],
    !scope.orgId && party.linkedOrgId ? db.ticket.count({ where: { orgId: party.linkedOrgId, status: { in: OPEN_TICKETS } } }) : 0,
    canSeePurchases ? db.purchaseDoc.findMany({ where: { orgId: scope.orgId!, supplierId: party.id }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], take: 100, include: { warehouse: { select: { name: true } }, lines: { select: { quantity: true, unitPriceCents: true, discountBps: true, vatRate: true } } } }) : Promise.resolve([]),
    canSeePurchases ? db.supplierItem.findMany({ where: { orgId: scope.orgId!, supplierId: party.id }, orderBy: [{ active: "desc" }, { tradeItem: { name: "asc" } }], take: 200, include: { tradeItem: { select: { id: true, name: true, ean: true } }, prices: { orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] } } }) : Promise.resolve([]),
  ]);
  const [fiscalDocuments, accountPayments, documentTypes] = canSeeAccount ? await Promise.all([
    db.fiscalDocument.findMany({
      where: { orgId: scope.orgId!, OR: [{ partyId: party.id }, { related: { is: { partyId: party.id } } }] },
      orderBy: { createdAt: "desc" }, take: 200,
      include: {
        sale: { select: { id: true, series: true, aa: true, issuedAt: true, totalCents: true, store: { select: { name: true } } } },
        series: { select: { code: true } },
        related: { select: { sale: { select: { id: true } } } },
      },
    }),
    db.payment.findMany({
      where: { sale: { orgId: scope.orgId!, fiscal: { partyId: party.id } } },
      orderBy: { createdAt: "desc" }, take: 200,
      include: { method: { select: { name: true } }, sale: { select: { id: true, series: true, aa: true, issuedAt: true, store: { select: { name: true } } } } },
    }),
    listDocTypes(),
  ]) : [[], [], []];
  const typeByCode = new Map(documentTypes.map((type) => [type.code, type]));
  const accountDocuments = fiscalDocuments.map((doc) => {
    const details = fiscalRequestDetails(doc.request);
    const saleNumber = doc.sale?.series && doc.sale.aa !== null ? `${doc.sale.series}-${doc.sale.aa}` : null;
    const requestNumber = details.series && details.aa !== null ? `${details.series}-${details.aa}` : null;
    return {
      id: doc.id, type: doc.docType, title: typeByCode.get(doc.docType)?.title ?? `Παραστατικό ${doc.docType}`,
      sign: typeByCode.get(doc.docType)?.sign ?? null, totalCents: doc.sale?.totalCents ?? details.totalCents,
      status: doc.status, at: doc.sale?.issuedAt ?? doc.createdAt, number: saleNumber ?? requestNumber ?? doc.receiptReference,
      href: doc.sale ? `/receipts/${doc.sale.id}` : doc.related?.sale ? `/receipts/${doc.related.sale.id}` : null,
      reference: doc.receiptReference, error: doc.error, origin: doc.sale?.store.name ?? (doc.series ? `Σειρά ${doc.series.code}` : "Εκτός ταμείου"),
    };
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
  const payments = accountPayments.map((payment) => ({
    id: payment.id, at: payment.sale.issuedAt ?? payment.createdAt, amountCents: payment.amountCents, success: payment.success,
    method: payment.method.name, saleId: payment.sale.id,
    saleNumber: payment.sale.series && payment.sale.aa !== null ? `${payment.sale.series}-${payment.sale.aa}` : "Πώληση χωρίς αριθμό",
    origin: payment.sale.store.name,
  }));
  const accountSummary = summarizePartyAccount(accountDocuments, payments);
  const marketing = currentConsents(consents).get("customer_marketing");
  const method = refs.methods.find(([c]) => c === party.paymentMethodId)?.[1];
  const facts: [string, string | null][] = [
    ["ΑΦΜ", party.vatNumber ? `${party.countryCode === "GR" ? "" : `${party.countryCode} `}${party.vatNumber}` : null], ["ΔΟΥ", party.taxOffice], ["Δραστηριότητα", party.profession],
    ["Κύρια επαφή", party.contactName], ["Κύριο email", party.email], ["Κύριο τηλέφωνο", party.phone ? showPhone(party.phone) : null],
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

  // ---- CRM: τι ξέρουμε για τη σχέση ----
  const manual = events[0];
  const working = party.contacts.filter((c) => c.active);
  const contactOptions = working.map((c): [string, string] => [c.personId, c.person.name]);
  const main = working.find((c) => c.isPrimary) ?? working[0];
  const pick = (channels: Channel[], kind: string) => channels.find((c) => c.kind === kind)?.value ?? null;
  const phone = party.phone ?? (main ? pick(main.person.channels, "phone") : null);
  const email = party.email ?? (main ? pick(main.person.channels, "email") : null);
  const talks = manual.filter((i) => CONTACT_KINDS.includes(i.kind));
  const last = talks[0]?.at ?? null;
  const tone = contactTone(last, now);
  const tasks = manual.filter((i) => i.task && !i.task.doneAt).sort((a, b) => (a.task!.dueAt?.getTime() ?? Infinity) - (b.task!.dueAt?.getTime() ?? Infinity));
  const late = tasks.filter((t) => taskState(t.task!, now) === "overdue").length;
  const recent = talks.filter((i) => now.getTime() - i.at.getTime() < 90 * 86_400_000).length;
  const months = monthBuckets(talks.map((i) => i.at), now);
  const peak = Math.max(1, ...months.map((m) => m.count));
  const timeline = mergeTimeline(events, show);
  const all = q.all === "1";
  const subscription = !scope.orgId ? party.linkedOrg?.subscription ?? null : null;
  const unpaid = subscription?.charges.reduce((s, c) => s + c.amountCents, 0) ?? 0;
  const log = logActivity.bind(null, party.id);
  const touch = scope.canEdit ? (id: string, what: "done" | "pin" | "delete") => touchActivity.bind(null, party.id, id, what) : undefined;
  const href = (t: Tab, extra = "") => `${base}${t === "overview" && !extra ? "" : `?tab=${t}${extra}`}`;
  const kpis: { label: string; value: string; hint: string; bad?: boolean }[] = [
    { label: "Τελευταία επικοινωνία", value: last ? ago(last, now) : "Καμία", hint: !last ? "Κατέγραψε την πρώτη κλήση ή email" : tone === "warning" ? "Πάνω από 2 μήνες σιωπή: πάρε ένα τηλέφωνο" : tone === "success" ? "Η σχέση είναι ζεστή" : "Μέσα στο τελευταίο δίμηνο", bad: tone === "warning" },
    { label: "Ανοιχτές εργασίες", value: String(tasks.length), hint: late ? `${late} ${late === 1 ? "έχει αργήσει" : "έχουν αργήσει"}: δες τα «Επόμενα βήματα»` : tasks.length ? "Καμία δεν έχει αργήσει" : "Καμία εκκρεμότητα", bad: late > 0 },
    { label: "Επαφές", value: String(working.length), hint: main ? `Κύρια: ${main.person.name}` : "Πρόσθεσε με ποιον μιλάς", bad: !working.length },
    subscription
      ? { label: "Απλήρωτες χρεώσεις", value: euro(unpaid), hint: unpaid ? `${subscription.charges.length} ${subscription.charges.length === 1 ? "χρέωση περιμένει" : "χρεώσεις περιμένουν"} πληρωμή` : "Όλες οι χρεώσεις έχουν πληρωθεί", bad: unpaid > 0 }
      : { label: "Επικοινωνίες 90 ημερών", value: String(recent), hint: recent ? "Κλήσεις, email και συναντήσεις" : "Καμία καταγραφή το τελευταίο τρίμηνο", bad: !recent },
  ];

  // συναρτήσεις που επιστρέφουν κομμάτια οθόνης (όχι components: ορίζονται μέσα στη σελίδα για να βλέπουν τον συναλλασσόμενο)
  const chip = (c: Channel, extra?: string | null) => (
    <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-card py-0.5 pr-1 pl-2 text-sm">
      <a href={channelHref(c.kind, c.value)} className="inline-flex min-h-7 min-w-0 items-center gap-1.5 font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11">
        {c.kind === "email" ? <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="truncate">{c.kind === "phone" ? showPhone(c.value) : c.value}</span>
      </a>
      {[c.label, extra].filter(Boolean).length ? <span className="text-xs text-muted-foreground">{[c.label, extra].filter(Boolean).join(" · ")}</span> : null}
      {c.isPrimary ? <Star className="size-3.5 shrink-0 fill-gold text-gold" aria-label="Κύριο" /> : scope.canEdit ? <form action={primaryChannel.bind(null, party.id, c.id)}><Submit aria-label={`Ορισμός ως κύριου: ${c.value}`} title="Ορισμός ως κύριου" className={btn("ghost", "sm", "w-7.5 px-0 text-muted-foreground")}><Star /></Submit></form> : null}
      {scope.canEdit ? <form action={deleteChannel.bind(null, party.id, c.id)}><Submit aria-label={`Διαγραφή: ${c.value}`} title="Διαγραφή" className={btn("ghost", "sm", "w-7.5 px-0 text-muted-foreground")}><Trash2 /></Submit></form> : null}
    </span>
  );
  const channelForm = (personId?: string) => (
    <form action={saveChannel.bind(null, party.id)} className="flex flex-wrap items-end gap-2">
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      <Select label="Είδος" name="kind" className={cn(INPUT, "w-32")} options={[["phone", "Τηλέφωνο"], ["email", "Email"]]} />
      <label className="min-w-40 flex-1 space-y-1 text-xs font-medium text-muted-foreground">Αριθμός ή διεύθυνση<input name="value" required maxLength={160} className={INPUT} /></label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">Ετικέτα<input name="label" list="channel-labels" maxLength={40} placeholder="π.χ. Κινητό" className={cn(INPUT, "w-36")} /></label>
      {!personId && party.addresses.length ? <Select label="Πού" name="addressId" className={cn(INPUT, "w-44")} options={addressOptions} /> : null}
      <Submit className={btn("outline")}><Plus /> Προσθήκη</Submit>
    </form>
  );
  const addressForm = (a?: (typeof party.addresses)[number]) => (
    <form key={a ? JSON.stringify(a) : "new"} action={saveAddress.bind(null, party.id, a?.id ?? null)} className={sub}>
      <Select label="Είδος" name="kind" defaultValue={a?.kind ?? "branch"} options={KIND_OPTIONS} />
      <Field label="Αριθμός εγκατάστασης" name="branchNo" type="number" min={1} max={9999} defaultValue={a?.branchNo ?? ""} hint="Μόνο για υποκατάστημα: όπως είναι δηλωμένο στην εφορία (η έδρα είναι 0)" />
      <Field label="Ονομασία" name="label" maxLength={80} defaultValue={a?.label ?? ""} placeholder="π.χ. Κατάστημα Γλυφάδας" />
      <AddressField label="Διεύθυνση" name="street" required minLength={2} maxLength={200} defaultValue={a?.street ?? ""} />
      <Field label="Τ.Κ." name="postalCode" maxLength={10} defaultValue={a?.postalCode ?? ""} />
      {/* αλληλοεξαρτώμενα γεωγραφικά (Καλλικράτης + πόλη/περιοχή από τις κοινές λίστες)· οι διευθύνσεις είναι εντός Ελλάδος */}
      <GeoCascade country="GR" initial={a ? { breadcrumb: crumbs.get(a.id), cityId: a.cityId, city: a.city, areaId: a.areaId, areaName: a.geoArea?.name ?? null } : undefined} />
      <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={a?.phone ?? ""} />
      <Field label="Email" name="email" type="email" maxLength={160} defaultValue={a?.email ?? ""} />
      <div className="grid grid-cols-2 gap-4"><Field label="Γεωγρ. πλάτος" name="latitude" inputMode="decimal" defaultValue={a?.latitude != null ? String(a.latitude).replace(".", ",") : ""} /><Field label="Γεωγρ. μήκος" name="longitude" inputMode="decimal" defaultValue={a?.longitude != null ? String(a.longitude).replace(".", ",") : ""} /></div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox name="locate" defaultChecked={!a} /> Αν δεν γράψω συντεταγμένες, βρες τες από τη διεύθυνση</label>
      <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">Τοποθέτηση στον χάρτη</summary><div className="mt-2"><PartyMap pick={{ lat: "latitude", lng: "longitude" }} points={a?.latitude != null && a.longitude != null ? [{ latitude: a.latitude, longitude: a.longitude, label: a.label ?? "Σημείο", primary: true }] : hq ? [{ ...hq, label: "Έδρα" }] : []} /></div></details>
      <div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" maxLength={300} defaultValue={a?.notes ?? ""} placeholder="π.χ. ώρες παραλαβής" /></div>
      <Submit className={btn("default")}>{a ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );
  const contactForm = (c?: (typeof party.contacts)[number]) => (
    <form key={c ? `${c.id}${c.person.name}${c.title}${c.addressId}${c.notes}` : "new"} action={saveContact.bind(null, party.id, c?.id ?? null)} className={sub}>
      {c ? null : (
        <div className="sm:col-span-2">
          <Select label="Πρόσωπο" name="personId" defaultValue="" options={[["", "Νέο πρόσωπο"], ...persons.map((x): [string, string] => [x.id, `${x.name}${x.links.length ? ` · ${x.links.map((l) => l.party.name).join(", ")}` : ""}`])]} />
          <p className="mt-1 text-xs text-muted-foreground">Αν συνεργάζεται ήδη με άλλον συναλλασσόμενό σου (π.χ. ο ίδιος λογιστής), διάλεξέ τον: τα τηλέφωνά του έρχονται μαζί</p>
        </div>
      )}
      <Field label="Ονοματεπώνυμο" name="name" maxLength={120} required={!!c} defaultValue={c?.person.name ?? ""} hint={c ? (c.person.links.length > 1 ? "Αλλάζει σε όλες τις εταιρίες του" : undefined) : "Μόνο για νέο πρόσωπο"} />
      <Field label="Ιδιότητα εδώ" name="title" maxLength={80} defaultValue={c?.title ?? ""} placeholder="π.χ. Λογιστήριο" />
      {c ? null : <><Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} hint="Μόνο για νέο πρόσωπο" /><Field label="Email" name="email" type="email" maxLength={160} /></>}
      <Select label="Πού βρίσκεται" name="addressId" defaultValue={c?.addressId ?? ""} options={addressOptions} />
      <Field label="Σημειώσεις" name="notes" maxLength={300} defaultValue={c?.notes ?? ""} />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const supplierRows = supplierItems.map((item) => ({ ...item, current: resolvePrice(item.prices, item.packQty, now) }));

  return (
    <Page section={`${scope.section} › Συναλλασσόμενοι`} title={party.name} description={[party.city, roleText(party.roles)].filter(Boolean).join(" · ")}
      actions={<>{party.linkedOrg ? <Link href={`/platform/${party.linkedOrg.id}`} className={btn("outline")}>Σελίδα συνδρομητή</Link> : null}<Link href={scope.base} className={btn("outline")}>Όλοι</Link></>}>
      <datalist id="channel-labels">{CHANNEL_LABELS.map((l) => <option key={l} value={l} />)}</datalist>
      <div className={cn("max-w-7xl space-y-4", scope.canEdit && "max-md:pb-16")}>
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε: {q.error.slice(0, 220)}</p> : null}

        <PartyIdentity
          name={party.name} tradeName={party.tradeName} roles={party.roles} active={party.active}
          vatNumber={party.vatNumber} countryCode={party.countryCode} taxOffice={party.taxOffice} profession={party.profession}
          address={party.address} postalCode={party.postalCode} city={party.city} region={party.region}
          phone={phone} email={email} website={party.website}
          payment={[method, party.paymentTermsDays != null ? (party.paymentTermsDays ? `${party.paymentTermsDays} ημέρες πίστωση` : "Μετρητοίς") : null].filter(Boolean).join(" · ") || null}
          notes={party.notes} verifiedAt={party.vatCheckedAt ? day.format(party.vatCheckedAt) : null} complete={!missing.length}
          actions={scope.canEdit ? <Modal wide label={<><Pencil /> Επεξεργασία στοιχείων</>} title="Στοιχεία συναλλασσόμενου"><PartyForm action={saveParty.bind(null, party.id)} party={party} refs={refs} geo={{ breadcrumb: crumbs.get("hq"), cityId: party.cityId, city: party.city, areaId: party.areaId, areaName: party.geoArea?.name ?? null, regionText: party.region }} /></Modal> : undefined}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav aria-label="Ενότητες καρτέλας" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {(Object.keys(TABS) as Tab[]).filter((t) => (t !== "transactions" || canSeePurchases) && (t !== "account" || canSeeAccount)).map((t) => (
              <Link key={t} href={href(t)} aria-current={tab === t ? "page" : undefined} className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium pointer-coarse:min-h-11", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
                {TABS[t]}{t === "contacts" ? <span className="tabular-nums opacity-70">{working.length}</span> : t === "places" ? <span className="tabular-nums opacity-70">{placeCount}</span> : t === "transactions" ? <span className="tabular-nums opacity-70">{party._count.purchaseDocs}</span> : t === "account" ? <span className="tabular-nums opacity-70">{accountDocuments.length}</span> : null}
              </Link>
            ))}
          </nav>
          {/* οι ίδιες τέσσερις ενέργειες: πάνω δεξιά σε οθόνη, σταθερά κάτω στο κινητό */}
          {scope.canEdit ? <QuickActions action={log} name={party.name} phone={phone} email={email} contacts={contactOptions} labels className="max-md:fixed max-md:inset-x-0 max-md:bottom-[var(--bottom-nav-h,0px)] max-md:z-30 max-md:border-t max-md:border-border max-md:bg-card max-md:gap-1.5 max-md:px-2 max-md:py-2 max-md:[&>*]:min-w-0 max-md:[&>*]:gap-1 max-md:[&>*]:px-1 md:[&>*]:flex-none" /> : null}
        </div>

        {tab === "overview" ? (
          <>
            {canSeeAccount ? <PartyAccountSummary summary={accountSummary} base={base} /> : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {kpis.map((k) => (
                  <Card key={k.label} className="px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
                    <p className={cn("mt-1.5 text-lg leading-tight font-semibold tabular-nums", k.bad && "text-destructive")}>{k.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
                  </Card>
                ))}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-4">
                {scope.canEdit ? <Card className="p-5"><ActivityForm action={log} contacts={contactOptions} /></Card> : null}
                <Card>
                  <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                    <h2 className="min-w-0 flex-1 text-lg">Χρονολόγιο</h2>
                    <nav aria-label="Φίλτρο χρονολογίου" className="flex flex-wrap gap-1">
                      {(Object.keys(TIMELINE_FILTERS) as TimelineFilter[]).map((f) => <Link key={f} href={f === "all" ? base : `${base}?show=${f}`} scroll={false} aria-current={show === f ? "true" : undefined} className={cn("inline-flex min-h-7.5 items-center rounded-md px-2.5 text-xs font-semibold pointer-coarse:min-h-11", show === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary")}>{TIMELINE_FILTERS[f]}</Link>)}
                    </nav>
                  </div>
                  <Timeline items={all ? timeline : timeline.slice(0, 30)} now={now} touch={touch} empty={show === "all" ? "Τίποτα ακόμα. Κάθε κλήση, email, σημείωση και εργασία που καταγράφεις φαίνεται εδώ, μαζί με ό,τι γίνεται αυτόματα" : "Τίποτα σε αυτή την κατηγορία"} />
                  {!all && timeline.length > 30 ? <p className="border-t border-border px-5 py-3 text-center"><Link href={`${base}?all=1${show === "all" ? "" : `&show=${show}`}`} scroll={false} className={btn("outline", "sm")}>Εμφάνιση και των {timeline.length - 30} παλαιότερων</Link></p> : null}
                </Card>
              </div>
              <div className="space-y-4">
                {subscription ? (
                  <Card>
                    <div className="border-b border-border px-5 py-3"><h2 className="text-lg">Ως συνδρομητής</h2></div>
                    <ul className="divide-y divide-border/70">
                      <li className="flex flex-wrap items-center gap-2 px-5 py-3"><span className="min-w-0 flex-1"><b>Συνδρομή</b><span className="block text-sm text-muted-foreground">{subscription.plan?.name ?? "Βασικό πακέτο"} · ως {day.format(subscription.currentPeriodEnd)}</span></span><Badge tone={SUBSCRIPTION[subscription.status].tone}>{SUBSCRIPTION[subscription.status].text}</Badge></li>
                      <li className="flex flex-wrap items-center gap-2 px-5 py-3"><span className="min-w-0 flex-1"><b>Χρεώσεις</b><span className="block text-sm text-muted-foreground">{unpaid ? `Απλήρωτα ${euro(unpaid)}: επικοινώνησε πριν κλειδώσει` : "Καμία απλήρωτη"}</span></span><Link href={`/platform/${party.linkedOrg!.id}`} className={btn("outline", "sm")}>Άνοιγμα</Link></li>
                      <li className="flex flex-wrap items-center gap-2 px-5 py-3"><span className="min-w-0 flex-1"><b>Αιτήματα υποστήριξης</b><span className="block text-sm text-muted-foreground">{openTickets ? `${openTickets} ανοιχτ${openTickets === 1 ? "ό" : "ά"}: περιμένουν απάντηση` : "Κανένα ανοιχτό"}</span></span><Link href="/platform/support" className={btn("outline", "sm")}>Αιτήματα</Link></li>
                    </ul>
                  </Card>
                ) : null}
                <Card>
                  <div className="border-b border-border px-5 py-3"><h2 className="text-lg">Επόμενα βήματα</h2><p className="text-sm text-muted-foreground">{tasks.length ? "Πάτα το ✓ όταν γίνει" : "Καμία ανοιχτή εργασία. Πρόσθεσε μία από το «Εργασία»"}</p></div>
                  {tasks.length ? (
                    <ul className="divide-y divide-border/70">
                      {tasks.slice(0, 6).map((t) => {
                        const st = taskState(t.task!, now);
                        return (
                          <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                            {touch ? <form action={touch(t.id, "done")}><Submit aria-label={`Ολοκληρώθηκε: ${t.title}`} title="Ολοκληρώθηκε" className={btn("outline", "sm", "w-7.5 px-0")}><Check /></Submit></form> : <CalendarClock className="size-4 text-muted-foreground" aria-hidden />}
                            <span className="min-w-0 flex-1"><b className="block truncate">{t.title}</b><span className={cn("text-xs", st === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>{dueText(t.task!.dueAt, now)}{t.person ? ` · ${t.person}` : ""}</span></span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </Card>
                <Card>
                  <div className="flex items-center gap-3 border-b border-border px-5 py-3"><h2 className="min-w-0 flex-1 text-lg">Με ποιον μιλάμε</h2><Link href={href("contacts")} className={btn("ghost", "sm")}>Όλες</Link></div>
                  {working.length ? (
                    <ul className="divide-y divide-border/70">
                      {working.slice(0, 5).map((c) => {
                        const tel = pick(c.person.channels, "phone"), mail = pick(c.person.channels, "email");
                        return (
                          <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground" aria-hidden>{initials(c.person.name)}</span>
                            <span className="min-w-0 flex-1"><b className="block truncate">{c.person.name}{c.isPrimary ? <Star className="ml-1 inline size-3.5 fill-gold text-gold" aria-label="Κύρια επαφή" /> : null}</b><span className="block truncate text-xs text-muted-foreground">{[c.title, tel ? showPhone(tel) : mail].filter(Boolean).join(" · ") || "Χωρίς στοιχεία"}</span></span>
                            {tel ? <a href={channelHref("phone", tel)} aria-label={`Κλήση: ${c.person.name}`} title={showPhone(tel)} className={btn("ghost", "sm", "w-7.5 px-0")}><Phone /></a> : null}
                            {mail ? <a href={channelHref("email", mail)} aria-label={`Email: ${c.person.name}`} title={mail} className={btn("ghost", "sm", "w-7.5 px-0")}><Mail /></a> : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="px-5 py-5 text-sm text-muted-foreground">Καμία επαφή ακόμα. <Link href={href("contacts")} className="font-semibold text-foreground underline underline-offset-2">Πρόσθεσε την πρώτη</Link></p>}
                </Card>
                <Card>
                  <div className="flex items-center gap-3 border-b border-border px-5 py-3"><div className="min-w-0 flex-1"><h2 className="text-lg">Στον χάρτη</h2><p className="text-sm text-muted-foreground">{points.length ? `${points.length} από ${placeCount} σημεία έχουν θέση` : "Κανένα σημείο δεν έχει θέση ακόμα"}</p></div><Link href={href("places")} className={btn("ghost", "sm")}>Διευθύνσεις</Link></div>
                  <div className="p-5">
                    {points.length ? <PartyMap points={points} className="h-52" /> : !party.address ? <p className="text-sm text-muted-foreground">Συμπλήρωσε πρώτα τη διεύθυνση της έδρας στα <Link href={href("details")} className="font-semibold text-foreground underline underline-offset-2">Στοιχεία</Link>, ή βάλε εκεί την πινέζα με το χέρι</p> : scope.canEdit ? <form action={locateParty.bind(null, party.id)}><Submit className={btn("outline")}><MapPin /> Εύρεση της έδρας στον χάρτη</Submit></form> : <p className="text-sm text-muted-foreground">Η έδρα δεν έχει τοποθετηθεί στον χάρτη</p>}
                  </div>
                </Card>
                <Card>
                  <div className="border-b border-border px-5 py-3"><h2 className="text-lg">Επικοινωνίες ανά μήνα</h2><p className="text-sm text-muted-foreground">{recent ? `${recent} το τελευταίο τρίμηνο` : "Καμία το τελευταίο τρίμηνο"} · κλήσεις, email, συναντήσεις</p></div>
                  <div role="img" aria-label={`Επικοινωνίες ανά μήνα: ${months.map((m) => `${m.label} ${m.count}`).join(", ")}`} className="grid h-36 grid-cols-6 items-end gap-2 px-5 pt-4 pb-3">
                    {months.map((m, i) => (
                      <div key={m.key} className="flex h-full flex-col items-center justify-end gap-1">
                        <span className="text-xs font-semibold tabular-nums">{m.count || ""}</span>
                        <span className={cn("w-full max-w-9 rounded-t", i === months.length - 1 ? "bg-primary" : "bg-primary/35", !m.count && "bg-border")} style={{ height: m.count ? `${Math.max(8, (m.count / peak) * 100)}%` : "2px" }} />
                        <span className="text-xs text-muted-foreground">{m.label}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </>
        ) : null}

        {tab === "account" && canSeeAccount ? (
          <PartyAccount base={base} view={accountView} summary={accountSummary} documents={accountDocuments} payments={payments} partyId={party.id} />
        ) : null}

        {tab === "transactions" && canSeePurchases ? (
          <div className="grid gap-4">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 basis-64 flex-1"><h2 className="flex items-center gap-2 text-lg"><PackageSearch className="size-5 text-muted-foreground" /> Είδη & τιμές προμηθευτή</h2><p className="mt-1 text-sm text-muted-foreground">Κωδικοί, barcode, συσκευασίες παραγγελίας και ισχύουσα τιμή προ ΦΠΑ. Διαχειρίζονται από την καρτέλα είδους.</p></div>
                <Link href="/items" className={btn("outline", "sm")}>Διαχείριση ειδών</Link>
              </div>
              <DataTable
                id={`party-supplier-items-${party.id}`}
                empty="Δεν έχουν συνδεθεί είδη με αυτόν τον προμηθευτή."
                columns={[
                  { key: "item", label: "Είδος", required: true, wrap: true },
                  { key: "code", label: "Κωδικός προμηθευτή", wrap: true },
                  { key: "barcode", label: "Barcode", wrap: true },
                  { key: "pack", label: "Συσκευασίες / παραγγελία", numeric: true },
                  { key: "price", label: "Ισχύουσα τιμή προ ΦΠΑ", numeric: true },
                  { key: "status", label: "Κατάσταση" },
                ]}
                rows={supplierRows.map((item) => ({
                  id: item.id,
                  cells: {
                    item: <span className="font-semibold leading-snug">{item.tradeItem.name}</span>,
                    code: item.supplierCode ?? "—",
                    barcode: <span className="break-all font-mono text-xs">{item.barcode ?? item.tradeItem.ean ?? "—"}</span>,
                    pack: item.packQty,
                    price: item.current ? <span className="whitespace-nowrap font-semibold">{euro(item.current.priceCents)}</span> : "—",
                    status: <Badge tone={item.active ? "success" : "neutral"}>{item.active ? "Ενεργό" : "Ανενεργό"}</Badge>,
                  },
                  details: {
                    label: item.tradeItem.name,
                    view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">Είδος</dt><dd className="mt-1 font-semibold break-words">{item.tradeItem.name}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Τιμή</dt><dd className="mt-1 font-semibold">{item.current ? `${euro(item.current.priceCents)} / συσκευασία` : "Δεν έχει καταχωριστεί"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Ισχύει από</dt><dd className="mt-1 font-semibold">{item.current ? day.format(item.current.validFrom) : "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Συμφωνία</dt><dd className="mt-1 font-semibold">{item.current?.minPackQty ? `Από ${item.current.minPackQty} συσκευασίες` : "Τιμοκατάλογος"}</dd></div>
                    </dl>,
                  },
                }))}
              />
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 basis-64 flex-1"><h2 className="flex items-center gap-2 text-lg"><ReceiptText className="size-5 text-muted-foreground" /> Ιστορικό παραστατικών</h2><p className="mt-1 text-sm text-muted-foreground">Τα {purchases.length} πιο πρόσφατα από {party._count.purchaseDocs} συνολικά · καθαρή αξία, ΦΠΑ και γενικό σύνολο από τις πραγματικές γραμμές.</p></div>
                <Link href={`/purchases?supplier=${party.id}`} className={btn("outline", "sm")}>Όλες οι αγορές</Link>
              </div>
              <DataTable
                id={`party-purchases-${party.id}`}
                empty="Δεν υπάρχει παραστατικό αγοράς από αυτόν τον προμηθευτή."
                columns={[
                  { key: "number", label: "Παραστατικό", required: true, wrap: true },
                  { key: "issuedAt", label: "Ημερομηνία" },
                  { key: "warehouse", label: "Αποθήκη", wrap: true },
                  { key: "lines", label: "Γραμμές", numeric: true },
                  { key: "net", label: "Καθαρή αξία", numeric: true },
                  { key: "vat", label: "ΦΠΑ", numeric: true },
                  { key: "total", label: "Γενικό σύνολο", numeric: true },
                  { key: "status", label: "Κατάσταση" },
                ]}
                rows={purchases.map((doc) => {
                  const totals = calculatePurchaseDocument(doc.lines, doc);
                  return {
                    id: doc.id,
                    cells: {
                      number: <Link href={`/purchases/${doc.id}`} className="font-semibold underline-offset-4 hover:underline">{doc.number ?? "Χωρίς αριθμό"}</Link>,
                      issuedAt: <span className="whitespace-nowrap">{doc.issuedAt ? day.format(doc.issuedAt) : "—"}</span>,
                      warehouse: doc.warehouse.name,
                      lines: doc.lines.length,
                      net: <span className="whitespace-nowrap">{euro(totals.totalNetCents)}</span>,
                      vat: <span className="whitespace-nowrap">{euro(totals.totalVatCents)}</span>,
                      total: <span className="whitespace-nowrap font-semibold">{euro(totals.totalCents)}</span>,
                      status: <Badge tone={PURCHASE_STATUS[doc.status].tone}>{PURCHASE_STATUS[doc.status].label}</Badge>,
                    },
                    details: {
                      label: doc.number ?? doc.id,
                      view: <div className="grid gap-4">
                        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div><dt className="text-xs text-muted-foreground">Πηγή</dt><dd className="mt-1 font-semibold">{doc.source === "ocr" ? "OCR · απαιτεί έλεγχο" : doc.source === "mydata" ? "myDATA" : "Χειροκίνητη καταχώριση"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Αποθήκη παραλαβής</dt><dd className="mt-1 font-semibold">{doc.warehouse.name}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">ΜΑΡΚ</dt><dd className="mt-1 break-all font-semibold">{doc.mydataMark ?? "—"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Σημείωση</dt><dd className="mt-1 break-words font-semibold">{doc.note ?? "—"}</dd></div>
                        </dl>
                        <div><Link href={`/purchases/${doc.id}`} className={btn("outline", "sm")}>Πλήρες παραστατικό & γραμμές</Link></div>
                      </div>,
                    },
                  };
                })}
              />
            </Card>
          </div>
        ) : null}

        {tab === "contacts" ? (
          <>
            <Card>
              <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Τηλέφωνα και email της επιχείρησης</h2><p className="text-sm text-muted-foreground">Όσα θέλεις, το καθένα με την ετικέτα του. Το αστέρι δείχνει το κύριο: αυτό μπαίνει στα παραστατικά</p></div>
              <div className="space-y-4 p-5">
                {party.channels.length ? <div className="flex flex-wrap gap-2">{party.channels.map((c) => chip(c, c.address ? (c.address.label ?? c.address.city) : null))}</div> : <p className="text-sm text-muted-foreground">Κανένα τηλέφωνο ή email ακόμα</p>}
                {scope.canEdit ? channelForm() : null}
              </div>
            </Card>
            <Card>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 basis-56 flex-1"><h2 className="text-lg">Επαφές</h2><p className="text-sm text-muted-foreground">Τα πρόσωπα με τα οποία μιλάς. Το ίδιο πρόσωπο μπορεί να είναι επαφή σε πολλούς συναλλασσόμενους</p></div>
                {scope.canEdit ? <Modal label={<><UserPlus /> Νέα επαφή</>} variant="default" title="Νέα επαφή">{contactForm()}</Modal> : null}
              </div>
              {party.contacts.length ? (
                <ul className="divide-y divide-border">
                  {party.contacts.map((c) => {
                    const others = c.person.links.filter((l) => l.partyId !== party.id);
                    return (
                      <li key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3", !c.active && "opacity-70")}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground" aria-hidden>{initials(c.person.name)}</span>
                        <div className="min-w-0 basis-52 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">{c.person.name}{c.isPrimary ? <Badge tone="success"><Star className="size-3" aria-hidden /> Κύρια επαφή</Badge> : null}{c.active ? null : <Badge>Δεν εργάζεται πλέον εδώ</Badge>}</p>
                          <p className="text-sm text-muted-foreground">{[c.title, c.address ? (c.address.label ?? c.address.city ?? c.address.street) : "Έδρα", c.notes].filter(Boolean).join(" · ")}</p>
                          {others.length ? <p className="text-xs text-muted-foreground">Επαφή και σε: {others.map((l, i) => <span key={l.id}>{i ? ", " : ""}<Link href={`${scope.base}/${l.party.id}?tab=contacts`} className="font-medium text-foreground underline underline-offset-2">{l.party.name}</Link></span>)}</p> : null}
                        </div>
                        <div className="flex min-w-0 basis-64 flex-[2] flex-wrap gap-1.5">{c.person.channels.length ? c.person.channels.map((x) => chip(x)) : <span className="text-sm text-muted-foreground">Χωρίς τηλέφωνο ή email</span>}</div>
                        {scope.canEdit ? <QuickActions action={log} name={c.person.name} phone={pick(c.person.channels, "phone")} email={pick(c.person.channels, "email")} contacts={contactOptions} personId={c.personId} /> : null}
                        {scope.canEdit ? (
                          <details className="group open:basis-full">
                            <summary className={cn(btn("outline", "sm"), "list-none [&::-webkit-details-marker]:hidden")}><Pencil /> <span className="group-open:hidden">Αλλαγή</span><span className="hidden group-open:inline">Κλείσιμο</span></summary>
                            <div className="mt-3 space-y-4 rounded-lg bg-secondary/50 p-4">
                              {contactForm(c)}
                              <div className="space-y-2 border-t border-border pt-4"><p className="text-sm font-semibold">Νέο τηλέφωνο ή email του {c.person.name}</p>{channelForm(c.personId)}</div>
                              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                                {c.isPrimary ? null : <form action={flagContact.bind(null, party.id, c.id, "primary")}><Submit className={btn("outline", "sm")}><Star /> Ορισμός ως κύριας</Submit></form>}
                                <form action={flagContact.bind(null, party.id, c.id, "active")}><Submit className={btn("outline", "sm")}><UserMinus /> {c.active ? "Δεν εργάζεται πλέον εδώ" : "Εργάζεται ξανά εδώ"}</Submit></form>
                                <form action={deleteContact.bind(null, party.id, c.id)}><Submit className={btn("ghost", "sm", "text-destructive")}><Trash2 /> Αφαίρεση από εδώ</Submit></form>
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία επαφή ακόμα. Πάτα «Νέα επαφή» για το πρώτο πρόσωπο</p>}
            </Card>
          </>
        ) : null}

        {tab === "places" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
          <Card>
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

          <Card>
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Στον χάρτη</h2><p className="text-sm text-muted-foreground">{points.length} από {placeCount} σημεία έχουν θέση{nearest ? ` · πιο κοντινό δικό σου κατάστημα: ${nearest.name}, ${nearest.km < 10 ? nearest.km.toFixed(1).replace(".", ",") : Math.round(nearest.km)} χλμ από την έδρα` : ""}</p></div>
            <div className="p-5">{points.length ? <PartyMap points={points} /> : <p className="text-sm text-muted-foreground">Κανένα σημείο δεν έχει συντεταγμένες ακόμα. Πάτα «Εύρεση στον χάρτη» στην έδρα, ή βάλε την πινέζα από το «Αλλαγή»</p>}</div>
          </Card>

          </div>
        ) : null}

        {tab === "files" ? (
          tenant ? (
            <Card>
              <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Έγγραφα</h2><p className="text-sm text-muted-foreground">Συμβάσεις, δικαιολογητικά, φωτογραφίες. Τα βλέπουν μόνο όσοι διαχειρίζονται συναλλασσόμενους. Κάθε αρχείο φαίνεται και στο χρονολόγιο</p></div>
              <div className="p-5"><Files orgId={tenant.org.id} category="customer_document" refType="customer" refId={party.id} empty="Κανένα έγγραφο ακόμα" /></div>
            </Card>
          ) : <Card className="px-5 py-6 text-sm text-muted-foreground">Τα αρχεία του συνδρομητή βρίσκονται στη σελίδα του. Για συναλλασσόμενους της πλατφόρμας δεν ανεβαίνουν ακόμα αρχεία εδώ</Card>
        ) : null}

        {tab === "details" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 basis-56 flex-1">
                <h2 className="text-lg">Στοιχεία {party.vatCheckedAt ? <Badge tone="success">Επιβεβαιώθηκαν από το μητρώο {day.format(party.vatCheckedAt)}</Badge> : null}</h2>
                <p className="text-sm text-muted-foreground">{missing.length ? `Για τιμολόγιο λείπουν: ${missing.join(", ")}` : "Τα στοιχεία τιμολόγησης είναι πλήρη"}</p>
              </div>
              {scope.canEdit ? <Modal wide label={<><Pencil /> Αλλαγή</>} title="Στοιχεία συναλλασσόμενου"><PartyForm action={saveParty.bind(null, party.id)} party={party} refs={refs} geo={{ breadcrumb: crumbs.get("hq"), cityId: party.cityId, city: party.city, areaId: party.areaId, areaName: party.geoArea?.name ?? null, regionText: party.region }} /></Modal> : null}
            </div>
            <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {facts.map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="font-semibold break-words">{v ?? <span className="font-normal text-muted-foreground">Δεν έχει συμπληρωθεί</span>}</dd></div>)}
            </dl>
            {party.notes ? <p className="border-t border-border px-5 py-4 text-muted-foreground"><span className="font-medium text-foreground">Σημειώσεις:</span> {party.notes}</p> : null}
          </Card>

          <div className="space-y-4">
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
                  {request ? (tenant.permissions.includes("gdpr.edit") ? <Link href="/gdpr" className={btn("outline", "sm")}>Στα αιτήματα</Link> : <Badge tone="warning">Σε εξέταση</Badge>) : (
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
        ) : null}
      </div>
    </Page>
  );
}
