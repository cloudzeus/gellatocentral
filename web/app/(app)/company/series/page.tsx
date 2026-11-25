import { CircleAlert, Lock, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { RoutedModal } from "@/components/modal";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { missingTypes, WHOLESALE_TYPES } from "@/lib/documents/settings";
import { filterParam, listParams } from "@/lib/paging";
import { statusOptions } from "@/lib/status";
import { requireStockContext } from "@/lib/stock-context";
import { saveSeriesAction } from "./actions";

const DAY = 86_400_000;
const when = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Athens" });

export default async function SeriesPage({ searchParams }: PageProps<"/company/series">) {
  const ctx = await requireStockContext("users.edit");
  const q = await searchParams;
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const list = listParams(q, 25, ["type", "code"]);
  const status = filterParam(q, "status", ["active", "inactive"] as const);
  const since = new Date(new Date().getTime() - 30 * DAY);

  const [org, types, stores, wholesaleStores, allSeries] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, legalName: true, vatNumber: true } }),
    db.documentType.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { code: "asc" }], select: { code: true, title: true, retail: true } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, legalEntity: { select: { name: true, vatNumber: true } } } }),
    db.wholesaleOrder.findMany({ where: { orgId: ctx.orgId }, distinct: ["storeId"], select: { storeId: true } }),
    db.documentSeries.findMany({ where: { orgId: ctx.orgId }, select: { id: true, docType: true, storeId: true, active: true } }),
  ]);
  const store = stores.find((s) => s.id === str("storeId"))?.id;

  const where = {
    orgId: ctx.orgId,
    ...(status ? { active: status === "active" } : {}),
    ...(store ? { storeId: store } : {}),
    ...(list.q ? { OR: [{ code: { contains: list.q, mode: "insensitive" as const } }, { name: { contains: list.q, mode: "insensitive" as const } }, { docType: { startsWith: list.q } }] } : {}),
  };
  const orderBy = list.sort === "code" ? [{ code: list.dir }] : [{ docType: list.sort === "type" ? list.dir : ("asc" as const) }, { code: "asc" as const }];
  const [rows, total] = await Promise.all([
    db.documentSeries.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { _count: { select: { documents: true } } } }),
    db.documentSeries.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const [last, recent] = await Promise.all([
    db.fiscalDocument.groupBy({ by: ["seriesId"], where: { orgId: ctx.orgId, seriesId: { in: ids } }, _max: { createdAt: true } }),
    db.fiscalDocument.groupBy({ by: ["seriesId"], where: { orgId: ctx.orgId, seriesId: { in: ids }, createdAt: { gte: since } }, _count: true }),
  ]);

  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const typeTitle = new Map(types.map((t) => [t.code, t.title]));
  const lastAt = new Map(last.map((l) => [l.seriesId!, l._max.createdAt]));
  const count30 = new Map(recent.map((r) => [r.seriesId!, r._count]));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const issuerOf = (storeId: string | null) => {
    const le = stores.find((s) => s.id === storeId)?.legalEntity;
    return le ? `${le.name} · ΑΦΜ ${le.vatNumber}` : `${org.legalName || org.name} · ΑΦΜ ${org.vatNumber}`;
  };

  // ειδοποιήσεις: κατάστημα με χονδρική χωρίς ενεργή σειρά για τιμολόγιο, δελτίο ή πιστωτικό
  const missing = wholesaleStores.flatMap(({ storeId }) => storeName.has(storeId) ? missingTypes(WHOLESALE_TYPES, allSeries, storeId).map((t) => ({ storeId, type: t })) : []);

  const editing = str("edit") ? await db.documentSeries.findFirst({ where: { id: str("edit"), orgId: ctx.orgId }, include: { _count: { select: { documents: true } } } }) : null;
  const showForm = !restricted && (str("new") === "1" || !!editing);
  const used = (editing?._count.documents ?? 0) > 0;
  const error = str("error") || null;
  const formType = str("type") || editing?.docType || "";
  const formStore = str("store") || editing?.storeId || "";
  const typeOptions: [string, string][] = [["", "Διάλεξε τύπο"], ...types.filter((t) => !t.retail).map((t) => [t.code, `${t.code} ${t.title}`] as [string, string])];
  const storeOptions: [string, string][] = [["", "Όλα τα καταστήματα"], ...stores.map((s) => [s.id, `${s.name} · ${s.legalEntity?.name ?? org.legalName ?? org.name}`] as [string, string])];
  const newHref = "/company/series?new=1";

  return (
    <Page section="Ρυθμίσεις" title="Σειρές παραστατικών" description="Κάθε τιμολόγιο, δελτίο και πιστωτικό εκδίδεται από σειρά του καταστήματος. Οι αποδείξεις λιανικής έχουν τη σειρά του ταμείου τους"
      actions={restricted ? undefined : <Link href={newHref} scroll={false} className={btn("default")}><Plus aria-hidden />Νέα σειρά</Link>}>
      <div className="grid gap-4">
        {restricted ? <p role="alert" className="rounded-lg bg-warning/15 p-3 text-warning-ink">Η επεξεργασία απαιτεί πρόσβαση σε όλα τα καταστήματα και αποθήκες.</p> : null}
        {error && !showForm ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p> : null}

        {missing.map((m) => (
          <div key={`${m.storeId}-${m.type}`} role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-warning/15 px-5 py-4 text-warning-ink">
            <CircleAlert className="size-5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1"><strong className="font-semibold">Λείπει σειρά για {m.type} {typeTitle.get(m.type)} στο {storeName.get(m.storeId)}.</strong> Η χονδρική του δεν μπορεί να εκδώσει αυτό το παραστατικό μέχρι να προστεθεί.</p>
            {restricted ? null : <Link href={`${newHref}&type=${encodeURIComponent(m.type)}&store=${m.storeId}`} scroll={false} className={btn("outline")}><Plus aria-hidden />Πρόσθεσε σειρά</Link>}
          </div>
        ))}

        <Card>
          <DataTable
            id="document-series"
            listing={{ ...list, total, placeholder: "Γράμμα, περιγραφή ή τύπος", filters: [
              { key: "status", label: "Κατάσταση", value: status, options: statusOptions("documentSeries") },
              { key: "storeId", label: "Κατάστημα", value: store, options: stores.map((s): [string, string] => [s.id, s.name]) },
            ] }}
            empty={<><p>Χωρίς σειρά δεν εκδίδεται τιμολόγιο, δελτίο αποστολής ή πιστωτικό. Ξεκίνα με μία σειρά τιμολογίων 1.1 για το κατάστημα που κάνει χονδρική.</p>
              {restricted ? null : <div className="mt-3 flex justify-center"><Link href={`${newHref}&type=1.1`} scroll={false} className={btn("default")}><Plus aria-hidden />Πρώτη σειρά</Link></div>}</>}
            columns={[
              { key: "type", label: "Τύπος", required: true, sortable: true, wrap: true },
              { key: "code", label: "Σειρά", sortable: true },
              { key: "store", label: "Κατάστημα και εκδότης", wrap: true },
              { key: "next", label: "Επόμενος", numeric: true },
              { key: "last", label: "Τελευταία έκδοση" },
              { key: "recent", label: "30 ημέρες", numeric: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={rows.map((s) => {
              const at = lastAt.get(s.id);
              return {
                id: s.id,
                cells: {
                  type: <span><span className="font-medium">{typeTitle.get(s.docType) ?? s.docType}</span> <span className="text-xs text-muted-foreground">{s.docType}</span></span>,
                  code: <span className="inline-flex items-center gap-1.5"><span className="font-semibold">{s.code}</span>{s._count.documents ? <Lock className="size-3.5 text-muted-foreground" aria-label="Έχει εκδόσεις: τύπος, γράμμα και κατάστημα κλειδωμένα" /> : null}{s.name ? <span className="text-xs text-muted-foreground">{s.name}</span> : null}</span>,
                  store: <span><span className="block">{s.storeId ? storeName.get(s.storeId) ?? "Ανενεργό κατάστημα" : "Όλα τα καταστήματα"}</span><span className="block text-xs text-muted-foreground">{issuerOf(s.storeId)}</span></span>,
                  next: `#${s.nextAa.toLocaleString("el-GR")}`,
                  last: at ? when.format(at) : <span className="text-muted-foreground">Καμία ακόμα</span>,
                  recent: (count30.get(s.id) ?? 0).toLocaleString("el-GR"),
                  status: <span className="flex flex-wrap gap-1"><StatusBadge kind="documentSeries" value={s.active ? "active" : "inactive"} />{s.isDefault && s.active ? <Badge>Προεπιλογή</Badge> : null}{s.transmit ? null : <Badge>Εσωτερική</Badge>}</span>,
                },
                actions: restricted ? undefined : <Link href={`/company/series?edit=${s.id}`} scroll={false} className={btn("ghost", "sm")} aria-label={`Αλλαγή σειράς ${s.code}`} title="Αλλαγή"><Pencil aria-hidden /></Link>,
              };
            })}
          />
        </Card>
      </div>

      {showForm ? (
        <RoutedModal title={editing ? `Σειρά ${editing.code}` : "Νέα σειρά"} description="Τα φορολογικά παραστατικά στέλνονται πάντα στην ΑΑΔΕ" closeHref="/company/series">
          <form action={saveSeriesAction} className="grid gap-4 sm:grid-cols-2">
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive sm:col-span-2">{error}</p> : null}
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            {used ? (
              <p className="flex items-start gap-2 rounded-lg bg-secondary p-3 sm:col-span-2"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />Η σειρά έχει {editing!._count.documents.toLocaleString("el-GR")} παραστατικά. Τύπος, γράμμα, κατάστημα και αριθμός μένουν ίδιοι με αυτούς που είδε η ΑΑΔΕ. Αλλάζει μόνο η περιγραφή, η προεπιλογή και αν είναι ενεργή.</p>
            ) : null}
            {used ? <><input type="hidden" name="storeId" value={editing!.storeId ?? ""} /><input type="hidden" name="docType" value={editing!.docType} /></> : null}
            <Select label="Κατάστημα" name={used ? "_store" : "storeId"} defaultValue={formStore} options={storeOptions} disabled={used} hint="Ο εκδότης (ΑΦΜ) προκύπτει από το κατάστημα" />
            <Select label="Τύπος παραστατικού" name={used ? "_type" : "docType"} defaultValue={formType} options={typeOptions} required disabled={used} />
            <Field label="Γράμμα σειράς" name="code" defaultValue={str("code") || editing?.code || ""} required maxLength={20} readOnly={used} hint="Όπως θα τυπωθεί, π.χ. «ΤΔΑ Α»" />
            <Field label="Περιγραφή" name="name" defaultValue={str("name") || editing?.name || ""} maxLength={120} hint="Για να την αναγνωρίζεις στην έκδοση" />
            <Field label={editing ? "Επόμενος αριθμός" : "Πρώτος αριθμός"} name="nextAa" type="number" min={1} defaultValue={editing?.nextAa ?? 1} readOnly={used} inputMode="numeric"
              hint={used ? "Προχωρά μόνος του με κάθε έκδοση" : "Αν συνεχίζεις από άλλο πρόγραμμα, βάλε τον επόμενο αριθμό του. Η αρίθμηση δεν ξεκινά από 1 κάθε χρόνο"} />
            <div className="grid content-start gap-3 sm:pt-6">
              <label className="flex items-start gap-3"><input type="checkbox" name="isDefault" value="true" defaultChecked={editing ? editing.isDefault : true} className="mt-1 size-4 accent-primary" />
                <span><strong className="font-medium">Προεπιλογή</strong><span className="block text-xs text-muted-foreground">Προτείνεται πρώτη για τον τύπο στο κατάστημα</span></span></label>
              {editing ? <label className="flex items-start gap-3"><input type="checkbox" name="active" value="true" defaultChecked={editing.active} className="mt-1 size-4 accent-primary" />
                <span><strong className="font-medium">Ενεργή</strong><span className="block text-xs text-muted-foreground">Ανενεργή σειρά δεν εμφανίζεται στην έκδοση</span></span></label> : null}
            </div>
            <Submit className={btn("default", "default", "justify-self-end sm:col-span-2")} pendingText="Αποθήκευση…">Αποθήκευση</Submit>
          </form>
        </RoutedModal>
      ) : null}
    </Page>
  );
}
