import { ArrowUpRight, Factory, FlaskConical, FolderTree, Package, Pencil, Plus, ScanSearch, Trash2 } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal, RoutedModal } from "@/components/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { Submit } from "@/components/submit";
import { StatusBadge } from "@/components/status-badge";
import { DetailGrid, btn, Card, menuItem, Page } from "@/components/ui";
import { look } from "@/lib/status";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatManufacturerBrand } from "@/lib/manufacturer";
import { filterParam, listParams } from "@/lib/paging";
import type { SelectOption } from "@/lib/select-options";
import { flattenTradeCategories } from "@/lib/trade-category-tree";
import { activateTradeItems, deleteTradeItem, hideTradeItems, toggleTradeItem } from "./actions";
import { CategoriesTable } from "./categories-table";
import { CategoryMatchEditor, type CategoryMatchBrandOption } from "./category-matches/category-match-editor";
import { CompositionDetails } from "./composition-details";
import { ItemForm } from "./item-form";
import { ManufacturersCard } from "./manufacturers-card";

// Κεντρικός κατάλογος με tabs και server-side αναζήτηση/σελιδοποίηση. Μόνο το επιλεγμένο είδος
// αποκτά φόρμα αλλαγής, ώστε τα πολυάριθμα brand options να μην επαναλαμβάνονται ανά γραμμή.
export default async function CatalogPage({ searchParams }: PageProps<"/platform/catalog">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "ean"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const tab = typeof q.tab === "string" && ["products", "manufacturers", "categories"].includes(q.tab) ? q.tab : "products";
  const like = { contains: list.q, mode: "insensitive" as const };
  const itemWhere = {
    orgId: null,
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [{ name: like }, { ean: { contains: list.q } }] } : {}),
  };
  const [categories, brands, items, itemsTotal, units, manufacturers] = await Promise.all([
    db.tradeCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.brand.findMany({ orderBy: { name: "asc" }, include: { manufacturer: true } }),
    db.tradeItem.findMany({
      where: itemWhere,
      orderBy: list.sort === "ean" ? { ean: list.dir } : { name: list.dir },
      skip: list.skip,
      take: list.take,
      include: { brand: { include: { manufacturer: true } }, category: true, contentUnit: true, composition: true },
    }),
    db.tradeItem.count({ where: itemWhere }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
    db.manufacturer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const brandOptions: [string, string][] = brands.map((b): [string, string] => [b.id, formatManufacturerBrand(b.manufacturer.name, b.name)]);
  const categoryOptions: [string, string][] = flattenTradeCategories(categories).map(({ category: c, depth }): [string, string] => [c.id, `${"— ".repeat(depth)}${c.name}`]);
  const manufacturerOptions: SelectOption[] = manufacturers.map((manufacturer) => [manufacturer.id, manufacturer.name]);
  const classificationBrandOptions: CategoryMatchBrandOption[] = brands.map((brand) => [brand.id, brand.name, brand.manufacturerId]);
  const editing = typeof q.edit === "string" ? items.find((item) => item.id === q.edit) : undefined;
  const editHref = (edit?: string) => {
    const params = new URLSearchParams(Object.entries({ tab: "products", q: list.q || undefined, status, sort: list.sort, dir: list.sort ? list.dir : undefined, page: list.page > 1 ? String(list.page) : undefined, edit }).filter((entry): entry is [string, string] => !!entry[1]));
    return `/platform/catalog?${params}`;
  };

  return (
    <Page section="Common Tables" title="Κατάλογος ειδών" description="Τα συσκευασμένα είδη που βρίσκουν όλοι οι συνδρομητές με EAN ή όνομα, με brand, συσκευασία και φωτογραφία"
      actions={<div className="flex flex-wrap gap-2"><Link href="/platform/catalog/category-matches" className={btn("outline")}><ScanSearch /> Συσχετίσεις ζαχαροπλαστικής</Link><Modal label={<><Plus /> Νέο είδος</>} variant="default" size="sm" title="Νέο είδος καταλόγου" wide><ItemForm categoryOptions={categoryOptions} brandOptions={brandOptions} units={units} /></Modal></div>}>
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}

        <Tabs key={tab} defaultValue={tab} className="gap-4">
          <TabsList aria-label="Ενότητες καταλόγου" className="grid w-full grid-cols-3 group-data-[orientation=horizontal]/tabs:h-12 pointer-coarse:group-data-[orientation=horizontal]/tabs:h-[52px] sm:inline-flex sm:w-fit">
            <TabsTrigger value="products" className="px-1 text-xs sm:px-2 sm:text-sm [&_svg]:hidden sm:[&_svg]:block"><Package /> Είδη</TabsTrigger>
            <TabsTrigger value="manufacturers" className="px-1 text-xs sm:px-2 sm:text-sm [&_svg]:hidden sm:[&_svg]:block"><Factory /> Κατασκευαστές</TabsTrigger>
            <TabsTrigger value="categories" className="px-1 text-xs sm:px-2 sm:text-sm [&_svg]:hidden sm:[&_svg]:block"><FolderTree /> Κατηγορίες</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <Card>
              <DataTable
                id="catalog"
                listing={{ ...list, total: itemsTotal, placeholder: "Όνομα ή EAN…", params: { tab: "products" }, filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"]] }] }}
                bulkActions={[
                  { value: "activate", label: "Εμφάνιση στους συνδρομητές", run: activateTradeItems },
                  { value: "hide", label: "Απόκρυψη από τους συνδρομητές", run: hideTradeItems, confirm: "Να αποκρυφτούν τα επιλεγμένα είδη από τους συνδρομητές;" },
                ]}
                empty="Κανένα είδος δεν ταιριάζει. Δοκίμασε άλλη αναζήτηση ή πρόσθεσε είδος με «Νέο είδος»"
                columns={[
                  { key: "name", label: "Όνομα", required: true, sortable: true },
                  { key: "ean", label: "EAN", sortable: true },
                  { key: "category", label: "Κατηγορία" },
                  { key: "brand", label: "Brand" },
                  { key: "content", label: "Περιεχόμενο", numeric: true },
                  { key: "status", label: "Κατάσταση" },
                ]}
                rows={items.map((t) => ({
                  id: t.id,
                  cells: {
                    name: (
                      <span className="flex items-center gap-2">
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- έρχεται από το CDN του Bunny, όχι από τον optimizer του Next
                          <img src={t.imageUrl} alt="" className="size-8 shrink-0 rounded-md border border-border/60 object-cover" loading="lazy" />
                        ) : null}
                        <span><Link href={`/platform/catalog/${t.id}`} className="font-semibold underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">{t.name}</Link>{t.packaging ? <span className="block text-xs text-muted-foreground">{t.packaging}</span> : null}</span>
                      </span>
                    ),
                    ean: <span className="tabular-nums">{t.ean ?? "—"}</span>,
                    category: t.category ? (t.category.parentId ? "— " : "") + t.category.name : "—",
                    brand: t.brand ? `${formatManufacturerBrand(t.brand.manufacturer.name, t.brand.name)}` : "—",
                    content: <span className="tabular-nums">{(t.contentQty / t.contentUnit.toBase).toLocaleString("el-GR")} {t.contentUnit.code}</span>,
                    status: t.active ? <StatusBadge look={look("success", "Ενεργό")} /> : <StatusBadge look={look("neutral", "Κρυφό")} />,
                  },
                  details: {
                    label: t.name,
                    view: (
                      <div className="grid gap-4">
                        <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                          <div className="bg-card p-4"><dt className="text-xs text-muted-foreground">EAN</dt><dd className="mt-1.5 break-words font-medium tabular-nums">{t.ean ?? "—"}</dd></div>
                          <div className="bg-card p-4"><dt className="text-xs text-muted-foreground">Κατηγορία</dt><dd className="mt-1.5 font-medium">{t.category?.name ?? "—"}</dd></div>
                          <div className="bg-card p-4"><dt className="text-xs text-muted-foreground">Κατασκευαστής / brand</dt><dd className="mt-1.5 font-medium">{t.brand ? `${formatManufacturerBrand(t.brand.manufacturer.name, t.brand.name)}` : "—"}</dd></div>
                          <div className="bg-card p-4"><dt className="text-xs text-muted-foreground">Περιεχόμενο</dt><dd className="mt-1.5 font-medium tabular-nums">{(t.contentQty / t.contentUnit.toBase).toLocaleString("el-GR")} {t.contentUnit.code}</dd></div>
                        </DetailGrid>
                        <div><Link href={`/platform/catalog/${t.id}`} className={btn("outline", "sm")}>Πλήρης καρτέλα και φωτογραφία <ArrowUpRight /></Link></div>
                      </div>
                    ),
                    extra: [{
                      value: "composition",
                      label: "Συστατικά",
                      icon: <FlaskConical />,
                      view: t.composition ? <div className="rounded-xl border border-border/70 bg-card p-5"><CompositionDetails composition={t.composition} /></div> : (
                        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
                          <FlaskConical className="mx-auto size-6 text-muted-foreground" />
                          <h3 className="mt-3 text-sm font-semibold">Δεν έχει καταχωρηθεί σύσταση</h3>
                          <p className="mt-1 text-xs text-muted-foreground">Συμπλήρωσε συστατικά, ποσοστά και αλλεργιογόνα από την καρτέλα του είδους.</p>
                          <Link href={`/platform/catalog/${t.id}#composition`} className={btn("outline", "sm", "mt-4")}>Προσθήκη συστατικών <ArrowUpRight /></Link>
                        </div>
                      ),
                    }],
                    edit: <CategoryMatchEditor itemId={t.id} categoryId={t.categoryId ?? ""} manufacturerId={t.brand?.manufacturer.id ?? ""} brandId={t.brand?.id ?? ""} categoryOptions={categoryOptions} manufacturerOptions={manufacturerOptions} brandOptions={classificationBrandOptions} existingCategory />,
                  },
                  menu: (
                    <>
                      <Link href={editHref(t.id)} role="menuitem" className={menuItem}><Pencil /> Αλλαγή</Link>
                      <Link href={`/platform/catalog/${t.id}`} role="menuitem" className={menuItem}>Πλήρης καρτέλα</Link>
                      <Link href={`/platform/catalog/${t.id}#composition`} role="menuitem" className={menuItem}><FlaskConical /> Σύσταση{t.composition ? " ✓" : ""}</Link>
                      <form action={toggleTradeItem.bind(null, t.id)}><Submit className={menuItem}>{t.active ? "Απόκρυψη από τους συνδρομητές" : "Εμφάνιση ξανά"}</Submit></form>
                      <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${t.name}`} description="Η ενέργεια επιτρέπεται μόνο αν το είδος δεν χρησιμοποιείται σε συνδρομητές ή αγορές.">
                        <form action={deleteTradeItem.bind(null, t.id)} className="grid gap-4">
                          <p className="text-sm text-muted-foreground">Θα διαγραφούν οριστικά το είδος και τυχόν φωτογραφία του. Η ενέργεια δεν αναιρείται.</p>
                          <Submit className={btn("destructive", "default", "justify-self-end")}>Οριστική διαγραφή</Submit>
                        </form>
                      </Modal>
                    </>
                  ),
                }))}
              />
            </Card>
          </TabsContent>
          <TabsContent value="manufacturers"><ManufacturersCard searchParams={q} /></TabsContent>
          <TabsContent value="categories"><CategoriesTable categories={categories} /></TabsContent>
        </Tabs>

        <p className="px-1 text-xs text-muted-foreground">Περιέχει δεδομένα από <a href="https://gr.openfoodfacts.org" target="_blank" rel="noreferrer" className="underline">Open Food Facts</a>, διαθέσιμα υπό την <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer" className="underline">Open Database License (ODbL)</a> · φωτογραφίες CC-BY-SA. Οι εικόνες των ειδών φιλοξενούνται στο Bunny της πλατφόρμας.</p>
      </div>
      {editing ? (
        <RoutedModal key={editing.id} title={`Αλλαγή: ${editing.name}`} description="Φωτογραφία και σύσταση διαχειρίζονται από την πλήρη καρτέλα." closeHref={editHref()} wide>
          <ItemForm item={editing} categoryOptions={categoryOptions} brandOptions={brandOptions} units={units} withFiles={false} returnTo="catalog" />
        </RoutedModal>
      ) : null}
    </Page>
  );
}
