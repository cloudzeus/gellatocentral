import { Building2, CircleAlert, CircleCheck, FileText, Pencil, Plus, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal, RoutedModal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select, Kpi } from "@/components/ui";
import { VatFillButton } from "@/components/vat-fill-button";
import { db } from "@/lib/db";
import { issuerReadiness } from "@/lib/documents/settings";
import { requireStockContext } from "@/lib/stock-context";
import { changeStoreIssuer, saveIssuer } from "./actions";

const DAY = 86_400_000;

// Μία γραμμή ετοιμότητας: εικονίδιο + λέξη, όχι μόνο χρώμα
function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon className={ok ? "mt-0.5 size-4 shrink-0 text-success-ink" : "mt-0.5 size-4 shrink-0 text-warning-ink"} aria-hidden />
      <span><span className="font-medium">{label}:</span> <span className={ok ? "text-muted-foreground" : "text-warning-ink"}>{detail}</span></span>
    </li>
  );
}

export default async function IssuersPage({ searchParams }: PageProps<"/company/issuers">) {
  const ctx = await requireStockContext("users.edit");
  const query = await searchParams;
  const since = new Date(new Date().getTime() - 30 * DAY);
  const [org, entities, stores, salesByStore, docsBySeries, series] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    db.legalEntity.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true, legalEntityId: true, _count: { select: { devices: { where: { active: true, kind: { in: ["POS_WEB", "POS_ANDROID"] } } } } } } }),
    db.sale.groupBy({ by: ["storeId"], where: { orgId: ctx.orgId, status: "COMPLETED", issuedAt: { gte: since } }, _count: true }),
    db.fiscalDocument.groupBy({ by: ["seriesId"], where: { orgId: ctx.orgId, createdAt: { gte: since }, seriesId: { not: null } }, _count: true }),
    db.documentSeries.findMany({ where: { orgId: ctx.orgId }, select: { id: true, storeId: true } }),
  ]);
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;

  // παραστατικά 30 ημερών ανά κατάστημα (αποδείξεις ταμείου + παραστατικά από σειρές), μετά ανά εκδότη
  const perStore = new Map<string, number>();
  for (const s of salesByStore) perStore.set(s.storeId, (perStore.get(s.storeId) ?? 0) + s._count);
  const seriesStore = new Map(series.map((s) => [s.id, s.storeId]));
  for (const d of docsBySeries) { const st = seriesStore.get(d.seriesId!); if (st) perStore.set(st, (perStore.get(st) ?? 0) + d._count); }

  const orgName = org.legalName || org.name;
  const issuers = [
    { key: "", id: null as string | null, name: orgName, vatNumber: org.vatNumber, taxOffice: org.taxOffice, address: org.address, city: org.city, postalCode: org.postalCode, active: true, readiness: issuerReadiness({ ...org, name: orgName }) },
    ...entities.map((e) => ({ key: e.id, id: e.id, name: e.name, vatNumber: e.vatNumber, taxOffice: e.taxOffice, address: e.address, city: e.city, postalCode: e.postalCode, active: e.active, readiness: issuerReadiness(e) })),
  ].map((i) => {
    const own = stores.filter((s) => (s.legalEntityId ?? "") === i.key);
    const ok = i.active && !i.readiness.missingFields.length && i.readiness.mydata;
    return { ...i, ok, stores: own, docs: own.reduce((n, s) => n + (perStore.get(s.id) ?? 0), 0) };
  });
  const active = issuers.filter((i) => i.active).length;
  const maxDocs = Math.max(1, ...issuers.map((i) => i.docs));
  const ready = issuers.filter((i) => i.ok).length;
  const issuerName = new Map(issuers.map((i) => [i.key, `${i.name} · ΑΦΜ ${i.vatNumber}`]));

  const editing = typeof query.edit === "string" ? entities.find((e) => e.id === query.edit) : undefined;
  const showForm = !restricted && (query.new === "1" || !!editing);
  const error = typeof query.error === "string" ? query.error : null;
  const editingStores = editing ? stores.filter((s) => s.legalEntityId === editing.id).length : 0;
  const issuerOptions: [string, string][] = [["", `${orgName} · ΑΦΜ ${org.vatNumber} (η επιχείρηση)`], ...entities.filter((e) => e.active).map((e) => [e.id, `${e.name} · ΑΦΜ ${e.vatNumber}`] as [string, string])];

  return (
    <Page section="Ρυθμίσεις" title="Εκδότες παραστατικών" description="Με ποιον ΑΦΜ εκδίδει κάθε κατάστημα. Κατάστημα που είναι άλλη εταιρεία, με δικό της ΑΦΜ, έχει δικό του εκδότη"
      actions={restricted ? undefined : <Link href="/company/issuers?new=1" scroll={false} className={btn("default")}><Plus aria-hidden />Νέος εκδότης</Link>}>
      <div className="grid gap-4">
        {restricted ? <p role="alert" className="rounded-lg bg-warning/15 p-3 text-warning-ink">Η επεξεργασία απαιτεί πρόσβαση σε όλα τα καταστήματα και αποθήκες.</p> : null}
        {error && !showForm ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p> : null}

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Σύνοψη">
          <Kpi icon={Building2} label="Εκδότες" value={String(active)} hint={active === 1 ? "Όλα τα καταστήματα εκδίδουν με τον ΑΦΜ της επιχείρησης" : "ΑΦΜ με δικά τους βιβλία"} />
          <Kpi icon={CircleCheck} label="Έτοιμοι να εκδίδουν" value={`${ready} / ${active}`} tone={ready < active ? "warning" : "success"}
            hint={ready === active ? "Όλοι έχουν στοιχεία και κλειδιά myDATA" : "Δες παρακάτω τι λείπει σε κάθε εκδότη"} />
          <Kpi icon={StoreIcon} label="Καταστήματα" value={String(stores.length)} hint={`${stores.filter((s) => s.legalEntityId).length} εκδίδουν με δικό τους ΑΦΜ`} />
        </section>

        <Card className="divide-y divide-border">
          {issuers.map((i) => (
            <section key={i.key || "org"} className="grid gap-4 p-5 md:grid-cols-[1fr_16rem]" aria-label={i.name}>
              <div className="grid content-start gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{i.name}</h2>
                  {i.id ? null : <Badge>Η επιχείρηση</Badge>}
                  <StatusBadge kind="issuer" value={!i.active ? "inactive" : i.ok ? "ready" : "missing"} />
                </div>
                <p className="text-muted-foreground">ΑΦΜ {i.vatNumber}{i.taxOffice ? ` · ΔΟΥ ${i.taxOffice}` : ""}{i.address ? ` · ${i.address}, ${i.postalCode ?? ""} ${i.city ?? ""}` : ""}</p>
                <ul className="grid gap-1.5">
                  <Check ok={!i.readiness.missingFields.length} label="Στοιχεία παραστατικού" detail={i.readiness.missingFields.length ? `λείπουν ${i.readiness.missingFields.join(", ")}` : "πλήρη"} />
                  <Check ok={i.readiness.mydata} label="myDATA" detail={i.readiness.mydata ? "συνδεδεμένο" : "χωρίς κλειδιά, τα τιμολόγια δεν διαβιβάζονται. Ζήτησέ τα από την υποστήριξη"} />
                  <Check ok={i.readiness.viva} label="Viva" detail={i.readiness.viva ? "έμπορος ορισμένος, τα ταμεία εκδίδουν κανονικά" : "χωρίς έμπορο, οι αποδείξεις των ταμείων δεν στέλνονται"} />
                </ul>
                <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                  <StoreIcon className="size-3.5" aria-hidden />
                  {i.stores.length ? i.stores.map((s) => s.name).join(", ") : "Κανένα κατάστημα δεν εκδίδει ακόμα με αυτόν. Διάλεξέ τον στα καταστήματα πιο κάτω"}
                </p>
              </div>
              <div className="grid content-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-muted-foreground"><FileText className="size-4" aria-hidden />Παραστατικά 30 ημερών</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{i.docs.toLocaleString("el-GR")}</p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-primary/10" role="img" aria-label={`${i.docs} παραστατικά, ο μεγαλύτερος εκδότης έχει ${maxDocs}`}><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((i.docs / maxDocs) * 100)}%` }} /></div>
                </div>
                {restricted ? null : i.id
                  ? <Link href={`/company/issuers?edit=${i.id}`} scroll={false} className={btn("outline", "default", "justify-self-start")}><Pencil aria-hidden />Επεξεργασία</Link>
                  : <Link href="/company" className={btn("outline", "default", "justify-self-start")}><Pencil aria-hidden />Στοιχεία επιχείρησης</Link>}
              </div>
            </section>
          ))}
        </Card>

        <Card>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">Καταστήματα: με ποιον ΑΦΜ εκδίδουν</h2>
            <p className="text-muted-foreground">Η αλλαγή ισχύει για τα επόμενα παραστατικά. Όσα εκδόθηκαν κρατούν τον εκδότη τους.</p>
          </div>
          <DataTable
            id="store-issuers"
            empty={<p>Δεν υπάρχουν ενεργά καταστήματα.</p>}
            columns={[
              { key: "store", label: "Κατάστημα", required: true },
              { key: "issuer", label: "Εκδίδει ως", wrap: true },
              { key: "tills", label: "Ταμεία", numeric: true },
              { key: "docs", label: "Παραστατικά 30 ημ.", numeric: true },
            ]}
            rows={stores.map((s) => ({
              id: s.id,
              cells: {
                store: <span><span className="font-medium">{s.name}</span>{s.city ? <span className="block text-xs text-muted-foreground">{s.city}</span> : null}</span>,
                issuer: issuerName.get(s.legalEntityId ?? "") ?? "—",
                tills: s._count.devices,
                docs: (perStore.get(s.id) ?? 0).toLocaleString("el-GR"),
              },
              menu: restricted ? undefined : (
                <Modal menuItem label={<><Building2 /> Αλλαγή εκδότη</>} title="Με ποιον ΑΦΜ εκδίδει" description={s.name}>
                  <form action={changeStoreIssuer} className="grid gap-4">
                    <input type="hidden" name="storeId" value={s.id} />
                    <Select label="Εκδίδει ως" name="legalEntityId" defaultValue={s.legalEntityId ?? ""} options={issuerOptions} />
                    <p className="text-muted-foreground">Τα ταμεία του καταστήματος θα εκδίδουν με τον νέο ΑΦΜ και θα χρεώνουν μέσω του εμπόρου Viva του. Δεν γίνεται αλλαγή όσο κάποιο ταμείο περιμένει πληρωμή.</p>
                    <Submit className={btn("default", "default", "justify-self-end")} pendingText="Αλλαγή…">Αλλαγή εκδότη</Submit>
                  </form>
                </Modal>
              ),
            }))}
          />
        </Card>
      </div>

      {showForm ? (
        <RoutedModal title={editing ? `Επεξεργασία: ${editing.name}` : "Νέος εκδότης"} description="Μόνο για κατάστημα που είναι άλλη εταιρεία, με δικό της ΑΦΜ" closeHref="/company/issuers">
          <form action={saveIssuer} className="grid gap-4 sm:grid-cols-2">
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive sm:col-span-2">{error}</p> : null}
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <Field label="ΑΦΜ" name="vatNumber" defaultValue={editing?.vatNumber ?? ""} required inputMode="numeric" maxLength={12} autoComplete="off" readOnly={editingStores > 0}
              hint={editingStores > 0 ? "Κλειδωμένος όσο καταστήματα εκδίδουν με αυτόν" : "9 ψηφία. Το κουμπί από κάτω φέρνει τα υπόλοιπα από το μητρώο"} />
            <Field label="Επωνυμία" name="name" defaultValue={editing?.name ?? ""} required maxLength={180} hint="Όπως στο Taxisnet, τυπώνεται στα παραστατικά" />
            {editingStores > 0 ? null : <div className="sm:col-span-2"><VatFillButton /></div>}
            <Field label="ΔΟΥ" name="taxOffice" defaultValue={editing?.taxOffice ?? ""} maxLength={100} />
            <Field label="Τηλέφωνο" name="phone" type="tel" defaultValue={editing?.phone ?? ""} maxLength={40} autoComplete="tel" />
            <div className="sm:col-span-2"><Field label="Διεύθυνση έδρας" name="address" defaultValue={editing?.address ?? ""} required maxLength={200} autoComplete="street-address" /></div>
            <Field label="Πόλη" name="city" defaultValue={editing?.city ?? ""} required maxLength={100} autoComplete="address-level2" />
            <Field label="ΤΚ" name="postalCode" defaultValue={editing?.postalCode ?? ""} required inputMode="numeric" maxLength={20} autoComplete="postal-code" />
            {editing ? (
              <label className="flex items-start gap-3 sm:col-span-2">
                <input type="checkbox" name="active" value="true" defaultChecked={editing.active} disabled={editingStores > 0} className="mt-1 size-4 accent-primary" />
                <span><strong className="font-medium">Ενεργός</strong><span className="block text-xs text-muted-foreground">{editingStores > 0 ? "Για να απενεργοποιηθεί, μετάφερε πρώτα τα καταστήματά του σε άλλον εκδότη" : "Ανενεργός εκδότης δεν προτείνεται στα καταστήματα"}</span></span>
                {editingStores > 0 ? <input type="hidden" name="active" value="true" /> : null}
              </label>
            ) : null}
            <ul className="grid gap-1 rounded-lg bg-secondary p-3 text-muted-foreground sm:col-span-2">
              <li>Κατάστημα της ίδιας εταιρείας σε άλλη πόλη εκδίδει με τον ΑΦΜ της επιχείρησης και δεν χρειάζεται εκδότη.</li>
              <li>Εμπόρευμα που πάει από έναν εκδότη σε άλλον είναι πώληση: εκδίδεται τιμολόγιο.</li>
              <li>Τα κλειδιά myDATA και τον έμπορο Viva του εκδότη τα ορίζει η υποστήριξη.</li>
            </ul>
            <Submit className={btn("default", "default", "justify-self-end sm:col-span-2")} pendingText="Αποθήκευση…">Αποθήκευση</Submit>
          </form>
        </RoutedModal>
      ) : null}
    </Page>
  );
}
