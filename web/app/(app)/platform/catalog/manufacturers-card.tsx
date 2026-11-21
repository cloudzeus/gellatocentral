import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { normalizeManufacturerName } from "@/lib/manufacturer";
import { filterParam } from "@/lib/paging";
import { deleteBrand, deleteBrands, deleteManufacturer, deleteManufacturers, saveBrand, saveManufacturer } from "./actions";

/** Server αναζήτηση και ταξινόμηση κατασκευαστών· τα brands ανοίγουν ως εσωτερικός πίνακας. */
export async function ManufacturersCard({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const mq = typeof searchParams.mq === "string" ? searchParams.mq.trim().slice(0, 80) : "";
  const search = normalizeManufacturerName(mq);
  const sort = filterParam(searchParams, "msort", ["name", "brands"]);
  const dir = filterParam(searchParams, "mdir", ["asc", "desc"]) ?? "asc";
  const brandSort = filterParam(searchParams, "bsort", ["name"]);
  const brandDir = filterParam(searchParams, "bdir", ["asc", "desc"]) ?? "asc";
  const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};
  const [manufacturers, total] = await Promise.all([
    db.manufacturer.findMany({ where, orderBy: { name: dir }, take: 50, include: { brands: { orderBy: { name: brandDir }, take: 12 }, _count: { select: { brands: true } } } }),
    db.manufacturer.count({ where }),
  ]);
  if (sort === "brands") {
    const direction = dir === "asc" ? 1 : -1;
    manufacturers.sort((a, b) => (a._count.brands - b._count.brands) * direction || a.name.localeCompare(b.name, "el"));
  }

  const manufacturerForm = (m?: { id: string; name: string }) => (
    <form action={saveManufacturer} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="manufacturerId" value={m?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={m?.name} hint="Αποθηκεύεται με κεφαλαία και χωρίς τόνους" />
      <Submit className={btn("default")}>{m ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );
  const brandForm = (brand?: { id: string; name: string; manufacturerId: string }, fixedManufacturerId?: string) => (
    <form action={saveBrand} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="brandId" value={brand?.id ?? ""} />
      <Select label="Κατασκευαστής" name="manufacturerId" required defaultValue={brand?.manufacturerId ?? fixedManufacturerId ?? manufacturers[0]?.id} options={manufacturers.map((m): [string, string] => [m.id, normalizeManufacturerName(m.name)])} />
      <Field label="Brand" name="name" required minLength={2} maxLength={80} defaultValue={brand?.name} hint="π.χ. ΤΩΝ 150" />
      <Submit className={btn("default")}>{brand ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );
  const state = { tab: "manufacturers", mq: mq || undefined, msort: sort, mdir: sort ? dir : undefined };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">Κατασκευαστές & brands</h2>
          <p className="text-sm text-muted-foreground">{total ? `${total.toLocaleString("el-GR")} κατασκευαστές${total > manufacturers.length ? ` · εμφανίζονται ${manufacturers.length}` : ""}` : "Κανένας κατασκευαστής ακόμα"}</p>
        </div>
        <Link href="/platform/catalog/duplicates" className={btn("outline", "sm")}>Διπλότυπα</Link>
        <Modal label={<><Plus /> Κατασκευαστής</>} size="sm" title="Νέος κατασκευαστής">{manufacturerForm()}</Modal>
        {manufacturers.length ? <Modal label={<><Plus /> Brand</>} size="sm" title="Νέο brand">{brandForm()}</Modal> : null}
      </div>
      <DataTable
        id="catalog-manufacturers"
        listing={{ q: mq, page: 1, pageSize: 50, total, placeholder: "Όνομα κατασκευαστή…", sort, dir, keys: { q: "mq", sort: "msort", dir: "mdir" }, params: { tab: "manufacturers" } }}
        bulkActions={[{ value: "delete", label: "Διαγραφή κατασκευαστών", run: deleteManufacturers, confirm: "Να διαγραφούν οριστικά οι επιλεγμένοι κατασκευαστές; Θα αποτύχει αν υπάρχουν brands." }]}
        empty={mq ? `Κανένας κατασκευαστής για «${mq}»` : "Κανένας κατασκευαστής ακόμα"}
        columns={[
          { key: "name", label: "Κατασκευαστής", required: true, sortable: true },
          { key: "brands", label: "Brands", numeric: true, sortable: true },
          { key: "preview", label: "Προεπισκόπιση" },
        ]}
        rows={manufacturers.map((m) => ({
          id: m.id,
          cells: {
            name: <span className="font-medium">{normalizeManufacturerName(m.name)}</span>,
            brands: m._count.brands,
            preview: m.brands.length ? m.brands.slice(0, 4).map((b) => b.name).join(", ") : "χωρίς brands",
          },
          details: {
            label: m.name,
            view: (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">{m._count.brands.toLocaleString("el-GR")} brands{m._count.brands > m.brands.length ? ` · εμφανίζονται ${m.brands.length}` : ""}</p>
                <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                  <DataTable
                    id={`catalog-brands-${m.id}`}
                    listing={{ q: "", page: 1, pageSize: Math.max(1, m.brands.length), total: m.brands.length, placeholder: "", showSearch: false, sort: brandSort, dir: brandDir, keys: { sort: "bsort", dir: "bdir" }, params: state }}
                    bulkActions={[{ value: "delete", label: "Διαγραφή brands", run: deleteBrands, confirm: `Να διαγραφούν τα επιλεγμένα brands του κατασκευαστή «${m.name}»;` }]}
                    empty="Χωρίς brands"
                    columns={[{ key: "name", label: "Brand", required: true, sortable: true }, { key: "manufacturer", label: "Κατασκευαστής" }]}
                    rows={m.brands.map((b) => ({
                      id: b.id,
                      cells: { name: <span className="font-medium">{b.name}</span>, manufacturer: normalizeManufacturerName(m.name) },
                      details: { label: b.name, view: <p className="text-sm text-muted-foreground">Brand του κατασκευαστή «{normalizeManufacturerName(m.name)}».</p>, edit: brandForm(b, m.id) },
                      menu: (
                        <>
                          <Modal menuItem label={<><Pencil /> Αλλαγή</>} title={`Αλλαγή: ${b.name}`}>{brandForm(b, m.id)}</Modal>
                          <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${b.name}`} description="Επιτρέπεται μόνο αν το brand δεν συνδέεται με είδη.">
                            <form action={deleteBrand.bind(null, b.id)} className="grid gap-4">
                              <p className="text-sm text-muted-foreground">Το brand θα διαγραφεί οριστικά από τον κατασκευαστή «{normalizeManufacturerName(m.name)}».</p>
                              <Submit className={btn("destructive", "default", "justify-self-end")}>Οριστική διαγραφή</Submit>
                            </form>
                          </Modal>
                        </>
                      ),
                    }))}
                  />
                </div>
              </div>
            ),
            edit: manufacturerForm(m),
          },
          menu: (
            <>
              <Modal menuItem label={<><Pencil /> Αλλαγή</>} title={`Αλλαγή: ${m.name}`}>{manufacturerForm(m)}</Modal>
              <Modal label={<><Plus /> Νέο brand</>} menuItem title={`Νέο brand: ${m.name}`}>{brandForm(undefined, m.id)}</Modal>
              <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${m.name}`} description="Επιτρέπεται μόνο αν ο κατασκευαστής δεν έχει brands.">
                <form action={deleteManufacturer.bind(null, m.id)} className="grid gap-4">
                  <p className="text-sm text-muted-foreground">Ο κατασκευαστής θα διαγραφεί οριστικά. Η ενέργεια δεν αναιρείται.</p>
                  <Submit className={btn("destructive", "default", "justify-self-end")}>Οριστική διαγραφή</Submit>
                </form>
              </Modal>
            </>
          ),
        }))}
      />
    </Card>
  );
}
