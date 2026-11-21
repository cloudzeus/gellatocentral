import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { saveGenericItem, toggleGenericItem } from "./actions";

// Γενικά είδη: αυτά που μπαίνουν στις συνταγές. Κάθε ένα δένει με συσκευασίες του κεντρικού
// καταλόγου και προμηθευτές — η σύνδεση γίνεται στην καρτέλα του είδους.
export default async function ItemsPage({ searchParams }: PageProps<"/items">) {
  const { org, can } = await currentOrg("items.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "unit", "vat", "mappings", "status"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    orgId: org.id,
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { name: { contains: list.q, mode: "insensitive" as const } } : {}),
  };
  const orderBy = list.sort === "unit" ? { baseUnit: { nameEL: list.dir } }
    : list.sort === "vat" ? { vatRate: { rate: list.dir } }
      : list.sort === "mappings" ? { mappings: { _count: list.dir } }
        : list.sort === "status" ? { active: list.dir }
          : { name: list.dir };
  const [items, total, units, vatRates] = await Promise.all([
    db.genericItem.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { baseUnit: true, vatRate: true, _count: { select: { mappings: true } } } }),
    db.genericItem.count({ where }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
    db.vatRate.findMany({ where: { active: true }, orderBy: { rate: "desc" } }),
  ]);

  const itemForm = (g?: (typeof items)[number]) => (
    <form key={g?.id ?? "new"} action={saveGenericItem} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="genericItemId" value={g?.id ?? ""} />
      <Field label="Όνομα είδους" name="name" required minLength={2} maxLength={80} defaultValue={g?.name} hint="Γενικά, όπως θα μπαίνει στη συνταγή: «γάλα φρέσκο», «ζάχαρη άχνη»" />
      <Select label="Μονάδα κατανάλωσης" name="baseUnitId" defaultValue={g?.baseUnitId ?? units.find((u) => u.code === "g")?.id} options={units.map((u): [string, string] => [u.id, `${u.nameEL} (${u.code})`])} />
      <Select label="ΦΠΑ αγοράς" name="vatRateId" defaultValue={g?.vatRateId ?? ""} options={[["", "— χωρίς προεπιλογή —"], ...vatRates.map((v): [string, string] => [v.id, `${v.name} ${v.rate}%`])]} />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{g ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Συνταγολόγιο" title="Γενικά είδη" description="Τα είδη των συνταγών και η σύνδεσή τους με συσκευασίες και προμηθευτές. Τα κρυμμένα δεν προτείνονται σε νέες συνδέσεις"
      actions={can("items.add") ? <Modal label={<><Plus /> Νέο είδος</>} size="sm" title="Νέο γενικό είδος">{itemForm()}</Modal> : null}>
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Τα είδη ενημερώθηκαν</p> : null}
        <Card>
          <DataTable
            id="items"
            listing={{
              ...list,
              total,
              placeholder: "Όνομα είδους…",
              filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"]] }],
            }}
            empty="Κανένα γενικό είδος ακόμα. Ξεκίνα με «Νέο είδος» και μετά σύνδεσέ το με συσκευασίες από τον κεντρικό κατάλογο"
            columns={[
              { key: "name", label: "Είδος", required: true, sortable: true },
              { key: "unit", label: "Μονάδα", sortable: true },
              { key: "vat", label: "ΦΠΑ αγοράς", sortable: true },
              { key: "mappings", label: "Συσκευασίες", sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={items.map((g) => ({
              id: g.id,
              cells: {
                name: <Link href={`/items/${g.id}`} className="font-semibold underline-offset-2 hover:underline">{g.name}</Link>,
                unit: `${g.baseUnit.nameEL} (${g.baseUnit.code})`,
                vat: g.vatRate ? `${g.vatRate.name} ${g.vatRate.rate}%` : "—",
                mappings: g._count.mappings ? `${g._count.mappings} συνδεδεμένες` : "καμία",
                status: g.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>,
              },
              details: {
                label: g.name,
                view: (
                  <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">Μονάδα</dt><dd className="font-medium">{g.baseUnit.nameEL} ({g.baseUnit.code})</dd></div>
                      <div><dt className="text-xs text-muted-foreground">ΦΠΑ αγοράς</dt><dd className="font-medium">{g.vatRate ? `${g.vatRate.name} ${g.vatRate.rate}%` : "Χωρίς προεπιλογή"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Συσκευασίες</dt><dd className="font-medium">{g._count.mappings}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Κατάσταση</dt><dd>{g.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}</dd></div>
                    </dl>
                    <Link href={`/items/${g.id}`} className={btn("outline", "sm")}><Eye /> Πλήρης καρτέλα</Link>
                  </div>
                ),
                edit: can("items.edit") ? itemForm(g) : undefined,
              },
              menu: (
                <>
                  <Link href={`/items/${g.id}`} role="menuitem" className={menuItem}><Eye /> Καρτέλα είδους</Link>
                  {can("items.edit") ? (
                    <>
                      <Modal menuItem label={<><Pencil /> Αλλαγή</>} size="sm" title={g.name}>{itemForm(g)}</Modal>
                      <form action={toggleGenericItem.bind(null, g.id)}>
                        <Submit className={menuItem}>{g.active ? "Απόκρυψη" : "Εμφάνιση ξανά"}</Submit>
                      </form>
                    </>
                  ) : null}
                </>
              ),
            }))}
          />
        </Card>
        <p className="text-xs text-muted-foreground">Η μονάδα κατανάλωσης ορίζει πώς μετράται το είδος στις συνταγές· οι συσκευασίες «σπάνε» αυτόματα σε αυτή τη μονάδα</p>
      </div>
    </Page>
  );
}
