import { ExternalLink, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Select } from "@/components/ui";
import { INGREDIENT_CATEGORIES, safeHttpsUrl, type IngredientCategory } from "@/lib/catalog-enrichment";
import { db } from "@/lib/db";
import { normalizeManufacturerName } from "@/lib/manufacturer";
import { filterParam } from "@/lib/paging";
import { deleteBrand, deleteBrands, deleteManufacturer, deleteManufacturers, enrichManufacturer, enrichManufacturers, saveBrand, saveManufacturer } from "./actions";

const STATUS = {
  pending: { label: "Αναμένει AI", tone: "neutral" as const },
  enriched: { label: "Εμπλουτισμένος", tone: "success" as const },
  review: { label: "Χρειάζεται έλεγχο", tone: "warning" as const },
  error: { label: "Σφάλμα AI", tone: "danger" as const },
};

type Citation = { url: string; title: string | null };
function citationsOf(source: unknown): Citation[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const citations = (source as { citations?: unknown }).citations;
  if (!Array.isArray(citations)) return [];
  return citations.flatMap((citation) => {
    if (!citation || typeof citation !== "object") return [];
    const value = citation as { url?: unknown; title?: unknown };
    const url = typeof value.url === "string" ? safeHttpsUrl(value.url) : null;
    return url ? [{ url: url.toString(), title: typeof value.title === "string" ? value.title : null }] : [];
  }).slice(0, 8);
}

/** Expandable κατασκευαστής: brands → προϊόντα, με τεκμηριωμένα υλικά και AI πηγές. */
export async function ManufacturersCard({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const mq = typeof searchParams.mq === "string" ? searchParams.mq.trim().slice(0, 80) : "";
  const search = normalizeManufacturerName(mq);
  const sort = filterParam(searchParams, "msort", ["name", "brands"]);
  const dir = filterParam(searchParams, "mdir", ["asc", "desc"]) ?? "asc";
  const brandSort = filterParam(searchParams, "bsort", ["name", "items"]);
  const brandDir = filterParam(searchParams, "bdir", ["asc", "desc"]) ?? "asc";
  const material = filterParam(searchParams, "material", ["pastry", "core"]);
  const where = {
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    ...(material ? { ingredients: { some: material === "pastry" ? { pastryRelevant: true } : { isCore: true } } } : {}),
  };
  const [manufacturers, total] = await Promise.all([
    db.manufacturer.findMany({
      where,
      orderBy: { name: dir },
      take: 50,
      include: {
        brands: { orderBy: { name: brandDir }, take: 12, include: { items: { orderBy: { name: "asc" }, take: 8, select: { id: true, name: true, active: true } }, _count: { select: { items: true } } } },
        ingredients: { orderBy: { ingredient: { name: "asc" } }, include: { ingredient: true } },
        _count: { select: { brands: true, ingredients: true } },
      },
    }),
    db.manufacturer.count({ where }),
  ]);
  if (sort === "brands") {
    const direction = dir === "asc" ? 1 : -1;
    manufacturers.sort((a, b) => (a._count.brands - b._count.brands) * direction || a.name.localeCompare(b.name, "el"));
  }

  const manufacturerForm = (m?: { id: string; name: string; website: string | null; logoUrl: string | null }) => (
    <form action={saveManufacturer} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="manufacturerId" value={m?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={m?.name} hint="Αποθηκεύεται με κεφαλαία και χωρίς τόνους" />
      <Field label="Επίσημο website" name="website" type="url" inputMode="url" maxLength={1000} defaultValue={m?.website ?? ""} placeholder="https://…" hint="HTTPS· το AI δεν αντικαθιστά αυτόματα τη χειροκίνητη τιμή" />
      <Field label="Λογότυπο" name="logoUrl" type="text" inputMode="url" maxLength={1200} defaultValue={m?.logoUrl ?? ""} placeholder="https://…/logo.png" hint="HTTPS εικόνα ή αποθηκευμένο αρχείο πλατφόρμας· προτιμώνται PNG/WebP" />
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
  const state = { tab: "manufacturers", mq: mq || undefined, msort: sort, mdir: sort ? dir : undefined, material };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">Κατασκευαστές, brands & πρώτες ύλες</h2>
          <p className="text-sm text-muted-foreground">{total ? `${total.toLocaleString("el-GR")} κατασκευαστές${total > manufacturers.length ? ` · εμφανίζονται ${manufacturers.length}` : ""} · άνοιξε μια γραμμή για προϊόντα ανά brand` : "Κανένας κατασκευαστής ακόμα"}</p>
        </div>
        <Link href="/platform/catalog/duplicates" className={btn("outline", "sm")}>Διπλότυπα & AI</Link>
        <Modal label={<><Plus /> Κατασκευαστής</>} size="sm" title="Νέος κατασκευαστής">{manufacturerForm()}</Modal>
        {manufacturers.length ? <Modal label={<><Plus /> Brand</>} size="sm" title="Νέο brand">{brandForm()}</Modal> : null}
      </div>
      <DataTable
        id="catalog-manufacturers"
        listing={{
          q: mq, page: 1, pageSize: 50, total, placeholder: "Όνομα κατασκευαστή…", sort, dir,
          keys: { q: "mq", sort: "msort", dir: "mdir" }, params: { tab: "manufacturers" },
          filters: [{ key: "material", label: "Υλικά", value: material, options: [["pastry", "Ζαχαροπλαστική"], ["core", "Βασικά υλικά"]] }],
        }}
        bulkActions={[
          { value: "enrich", label: "AI εμπλουτισμός (έως 3)", run: enrichManufacturers, confirm: "Να γίνει web αναζήτηση και AI εμπλουτισμός; Θα καταγραφεί το κόστος. Δεν γίνεται αυτόματη συγχώνευση." },
          { value: "delete", label: "Διαγραφή κατασκευαστών", run: deleteManufacturers, confirm: "Να διαγραφούν οριστικά οι επιλεγμένοι κατασκευαστές; Θα αποτύχει αν υπάρχουν brands." },
        ]}
        empty={mq || material ? "Κανένας κατασκευαστής με αυτά τα κριτήρια" : "Κανένας κατασκευαστής ακόμα"}
        columns={[
          { key: "name", label: "Κατασκευαστής", required: true, sortable: true },
          { key: "brands", label: "Brands", numeric: true, sortable: true },
          { key: "ingredients", label: "Υλικά", numeric: true },
          { key: "status", label: "AI" },
          { key: "preview", label: "Προεπισκόπιση", wrap: true },
        ]}
        rows={manufacturers.map((m) => {
          const website = safeHttpsUrl(m.website);
          const citations = citationsOf(m.enrichmentSource);
          const status = STATUS[m.enrichmentStatus as keyof typeof STATUS] ?? STATUS.pending;
          return {
            id: m.id,
            cells: {
              name: (
                <span className="flex min-w-0 items-center gap-2.5">
                  {m.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- δικό μας CDN ή ρητό HTTPS URL διαχειριστή
                    <img src={m.logoUrl} alt="" className="size-9 shrink-0 rounded-md border border-border/60 bg-white object-contain p-1" loading="lazy" />
                  ) : <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold">{m.name.slice(0, 1)}</span>}
                  <span className="min-w-0"><span className="block truncate font-medium">{normalizeManufacturerName(m.name)}</span>{website ? <span className="block truncate text-xs text-muted-foreground">{website.hostname.replace(/^www\./, "")}</span> : null}</span>
                </span>
              ),
              brands: m._count.brands,
              ingredients: m._count.ingredients,
              status: <Badge tone={status.tone}>{status.label}</Badge>,
              preview: m.brands.length ? m.brands.slice(0, 4).map((b) => b.name).join(", ") : "χωρίς brands",
            },
            details: {
              label: m.name,
              view: (
                <div className="grid gap-5">
                  <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-xs text-muted-foreground">Website</p>{website ? <a href={website.toString()} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">{website.hostname.replace(/^www\./, "")}<ExternalLink className="size-3.5" /></a> : <p className="mt-1">Δεν έχει επαληθευτεί</p>}</div>
                    <div><p className="text-xs text-muted-foreground">Περιεχόμενο</p><p className="mt-1 font-medium">{m._count.brands} brands · {m._count.ingredients} υλικά</p></div>
                    <div><p className="text-xs text-muted-foreground">Τελευταίος εμπλουτισμός</p><p className="mt-1 font-medium">{m.enrichedAt?.toLocaleDateString("el-GR") ?? "Ποτέ"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Aliases</p><p className="mt-1 font-medium">{m.aliases.length ? m.aliases.join(", ") : "—"}</p></div>
                  </div>
                  {m.enrichmentError ? <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-ink">{m.enrichmentError}</p> : null}
                  {citations.length ? <div><p className="mb-2 text-xs font-semibold text-muted-foreground">Πηγές AI</p><div className="flex flex-wrap gap-2">{citations.map((citation, index) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className={btn("outline", "sm")}>{citation.title || `Πηγή ${index + 1}`}<ExternalLink /></a>)}</div></div> : null}

                  <section>
                    <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Βασικές πρώτες ύλες</h3><span className="text-xs text-muted-foreground">Μόνο με απόδειξη από προϊόν</span></div>
                    {m.ingredients.length ? <div className="grid gap-2 sm:grid-cols-2">{m.ingredients.map((relation) => (
                      <div key={relation.ingredientId} className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-medium">{relation.ingredient.name}</span><Badge>{INGREDIENT_CATEGORIES[relation.ingredient.category as IngredientCategory] ?? relation.ingredient.category}</Badge>{relation.isCore ? <Badge tone="success">Βασική</Badge> : null}{relation.pastryRelevant ? <Badge tone="warning">Ζαχαροπλαστική</Badge> : null}</div>
                        {relation.evidence ? <p className="mt-1.5 text-xs text-muted-foreground">Απόδειξη: «{relation.evidence}»</p> : null}
                      </div>
                    ))}</div> : <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">Δεν έχουν εξαχθεί υλικά. Ο AI εμπλουτισμός χρησιμοποιεί τα ονόματα και τα συστατικά των προϊόντων.</p>}
                  </section>

                  <section className="grid gap-3">
                    <div><h3 className="text-sm font-semibold">Προϊόντα ανά brand</h3><p className="text-xs text-muted-foreground">{m._count.brands.toLocaleString("el-GR")} brands{m._count.brands > m.brands.length ? ` · εμφανίζονται ${m.brands.length}` : ""} · έως 8 προϊόντα ανά brand</p></div>
                    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                      <DataTable
                        id={`catalog-brands-${m.id}`}
                        listing={{ q: "", page: 1, pageSize: Math.max(1, m.brands.length), total: m.brands.length, placeholder: "", showSearch: false, sort: brandSort, dir: brandDir, keys: { sort: "bsort", dir: "bdir" }, params: state }}
                        bulkActions={[{ value: "delete", label: "Διαγραφή brands", run: deleteBrands, confirm: `Να διαγραφούν τα επιλεγμένα brands του κατασκευαστή «${m.name}»;` }]}
                        empty="Χωρίς brands"
                        columns={[{ key: "name", label: "Brand", required: true, sortable: true }, { key: "items", label: "Είδη", numeric: true, sortable: true }, { key: "products", label: "Προϊόντα", wrap: true }]}
                        rows={[...m.brands].sort(brandSort === "items" ? (a, b) => (a._count.items - b._count.items) * (brandDir === "asc" ? 1 : -1) || a.name.localeCompare(b.name, "el") : () => 0).map((b) => ({
                          id: b.id,
                          cells: {
                            name: <span className="font-medium">{b.name}</span>,
                            items: b._count.items,
                            products: b.items.length ? <span className="flex flex-wrap gap-x-3 gap-y-1">{b.items.map((item) => <Link key={item.id} href={`/platform/catalog/${item.id}`} className={item.active ? "underline-offset-2 hover:underline" : "text-muted-foreground line-through"}>{item.name}</Link>)}{b._count.items > b.items.length ? <span className="text-muted-foreground">+{b._count.items - b.items.length}</span> : null}</span> : <span className="text-muted-foreground">χωρίς προϊόντα</span>,
                          },
                          details: { label: b.name, view: b.items.length ? <ul className="grid gap-2 text-sm">{b.items.map((item) => <li key={item.id}><Link href={`/platform/catalog/${item.id}`} className="underline-offset-2 hover:underline">{item.name}</Link>{!item.active ? <span className="text-muted-foreground"> · κρυφό</span> : null}</li>)}</ul> : <p className="text-sm text-muted-foreground">Το brand δεν έχει συνδεδεμένα προϊόντα.</p>, edit: brandForm(b, m.id) },
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
                  </section>
                </div>
              ),
              edit: manufacturerForm(m),
            },
            menu: (
              <>
                <form action={enrichManufacturer.bind(null, m.id)}><Submit pendingText="Αναζήτηση…" className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-secondary"><Sparkles className="size-4" /> AI εμπλουτισμός</Submit></form>
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
          };
        })}
      />
    </Card>
  );
}
