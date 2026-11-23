import { ArrowLeft, ArrowUpRight, FlaskConical, ListChecks, Package, Tag } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Badge, btn, Card, menuItem, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { matchCatalogCategories } from "@/lib/catalog-category-matcher";
import { db } from "@/lib/db";
import { formatManufacturerBrand } from "@/lib/manufacturer";
import { filterParam, listParams } from "@/lib/paging";
import type { SelectOption } from "@/lib/select-options";
import { flattenTradeCategories } from "@/lib/trade-category-tree";
import { applyCategoryMatches } from "../actions";
import { CompositionDetails } from "../composition-details";
import { CategoryMatchEditor, type CategoryMatchBrandOption } from "./category-match-editor";

function CategorySuggestion({ path }: { path: string }) {
  const parts = path.split(" → ");
  const leaf = parts.at(-1) ?? path;
  const parents = parts.slice(0, -1);
  return (
    <span className="block min-w-0 py-0.5">
      {parents.length ? <span className="block text-2xs leading-5 text-muted-foreground">{parents.join(" › ")}</span> : null}
      <span className="mt-1 inline-flex max-w-full items-center rounded-md border border-primary/15 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary">{leaf}</span>
    </span>
  );
}

// Οι προτάσεις είναι αναγνώσιμες και προσωρινές· η κατηγορία γράφεται μόνο μετά από επιλογή και server έλεγχο.
export default async function CatalogCategoryMatchesPage({ searchParams }: PageProps<"/platform/catalog/category-matches">) {
  await requirePlatform("settings.read");
  const params = await searchParams;
  const list = listParams(params, 50);
  const [categories, items, manufacturers, brands] = await Promise.all([
    db.tradeCategory.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, parentId: true, name: true, position: true, active: true } }),
    db.tradeItem.findMany({
      where: { orgId: null, categoryId: null },
      select: { id: true, name: true, ean: true, imageUrl: true, composition: true, brand: { select: { id: true, name: true, manufacturer: { select: { id: true, name: true } } } } },
    }),
    db.manufacturer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, manufacturerId: true } }),
  ]);
  const categoryOptions = categories.map((category) => category.id);
  const categoryFilter = filterParam(params, "category", categoryOptions);
  const matches = matchCatalogCategories(items.map((item) => ({ id: item.id, name: item.name, brandName: item.brand?.name })), categories);
  const byId = new Map(items.map((item) => [item.id, item]));
  const search = list.q.toLocaleLowerCase("el");
  const rows = matches.flatMap((match) => {
    const item = byId.get(match.itemId);
    if (!item || (categoryFilter && match.categoryId !== categoryFilter)) return [];
    const searchText = `${item.name} ${item.ean ?? ""} ${item.brand?.name ?? ""} ${item.brand?.manufacturer.name ?? ""} ${match.categoryPath}`.toLocaleLowerCase("el");
    return search && !searchText.includes(search) ? [] : [{ ...match, item }];
  }).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "el"));
  const pages = Math.max(1, Math.ceil(rows.length / list.pageSize));
  const page = Math.min(list.page, pages);
  const visible = rows.slice((page - 1) * list.pageSize, page * list.pageSize);
  const matchedCategoryIds = [...new Set(matches.map((match) => match.categoryId))];
  const options: [string, string][] = categories.filter((category) => matchedCategoryIds.includes(category.id)).map((category): [string, string] => [category.id, category.name]).sort((a, b) => a[1].localeCompare(b[1], "el"));
  const editCategoryOptions: SelectOption[] = flattenTradeCategories(categories).map(({ category, depth }): SelectOption => [category.id, `${"— ".repeat(depth)}${category.name}`]);
  const manufacturerOptions: SelectOption[] = manufacturers.map((manufacturer) => [manufacturer.id, manufacturer.name]);
  const brandOptions: CategoryMatchBrandOption[] = brands.map((brand) => [brand.id, brand.name, brand.manufacturerId]);

  return (
    <Page section="Common Tables" title="Συσχετίσεις ζαχαροπλαστικής & παγωτού" description={`${matches.length.toLocaleString("el-GR")} σαφείς προτάσεις από ${items.length.toLocaleString("el-GR")} ακατηγοριοποίητα κεντρικά είδη · χωρίς AI χρέωση`}
      actions={<div className="max-sm:w-full"><Link href="/platform/catalog" className={btn("outline", "default", "max-sm:w-full")}><ArrowLeft /> Κατάλογος</Link></div>}>
      <div className="grid max-w-[1600px] gap-4">
        <Card className="border-primary/15 bg-primary/5 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ListChecks className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Έλεγχος πριν από την εφαρμογή</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Άνοιξε μια γραμμή για τεκμηρίωση, συστατικά ή χειροκίνητη διόρθωση. Οι συσχετίσεις χρησιμοποιούν μόνο τις {categories.length.toLocaleString("el-GR")} υπάρχουσες κατηγορίες και κάθε εγγραφή ελέγχεται ξανά στον server.</p>
            </div>
            <Badge tone="warning">Έως 200 είδη / ενέργεια</Badge>
          </div>
        </Card>
        <Card>
          <DataTable
            id="catalog-category-matches"
            listing={{ ...list, page, total: rows.length, placeholder: "Προϊόν, EAN, brand ή κατηγορία…", filters: [{ key: "category", label: "Κατηγορία", value: categoryFilter, options }] }}
            bulkActions={[{ value: "apply", label: "Εφαρμογή επιλεγμένων συσχετίσεων", run: applyCategoryMatches, confirm: "Να εφαρμοστούν οι εμφανιζόμενες προτεινόμενες κατηγορίες στα επιλεγμένα είδη;" }]}
            empty="Δεν βρέθηκαν σαφείς συσχετίσεις με τις κατηγορίες ζαχαροπλαστικής και παγωτού"
            columns={[
              { key: "product", label: "Προϊόν", required: true, wrap: true },
              { key: "brand", label: "Κατασκευαστής / brand", wrap: true },
              { key: "category", label: "Προτεινόμενη κατηγορία", wrap: true },
              { key: "score", label: "Βεβαιότητα", numeric: true, sortable: false },
            ]}
            rows={visible.map(({ item, ...match }) => ({
              id: item.id,
              cells: {
                product: (
                  <span className="flex min-w-0 items-center gap-3 py-1">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- αποθηκευμένη εικόνα του Bunny CDN
                      <img src={item.imageUrl} alt="" className="size-11 shrink-0 rounded-lg border border-border/60 bg-secondary object-cover" loading="lazy" />
                    ) : <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary text-muted-foreground"><Package className="size-4" /></span>}
                    <span className="min-w-0">
                      <Link href={`/platform/catalog/${item.id}`} className="block font-semibold leading-5 underline-offset-2 hover:underline">{item.name}</Link>
                      {item.ean ? <span className="mt-1 block text-2xs text-muted-foreground tabular-nums">EAN {item.ean}</span> : null}
                    </span>
                  </span>
                ),
                brand: item.brand ? (
                  <span className="block py-1 text-sm font-medium">
                    {formatManufacturerBrand(item.brand.manufacturer.name, item.brand.name)}
                  </span>
                ) : <span className="text-xs text-muted-foreground">Χωρίς brand</span>,
                category: <CategorySuggestion path={match.categoryPath} />,
                score: <span className="inline-flex min-w-20 flex-col items-end gap-1 py-1"><Badge tone={match.score >= 85 ? "success" : "warning"}>{match.score} / 99</Badge><span className="text-2xs text-muted-foreground">{match.score >= 85 ? "Ισχυρή" : "Χρειάζεται έλεγχο"}</span></span>,
              },
              details: {
                label: item.name,
                view: (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
                    <section className="rounded-xl border border-border/70 bg-card p-5">
                      <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Tag className="size-4 text-primary" /> Προτεινόμενη κατηγορία</h3>
                      <div className="mt-3 text-base"><CategorySuggestion path={match.categoryPath} /></div>
                    </section>
                    <section className="rounded-xl border border-border/70 bg-card p-5">
                      <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-muted-foreground">Τεκμηρίωση πρότασης</h3><Badge tone={match.score >= 85 ? "success" : "warning"}>{match.score} / 99</Badge></div>
                      <p className="mt-3 text-sm leading-relaxed">{match.evidence}</p>
                    </section>
                  </div>
                ),
                extra: [{
                  value: "composition",
                  label: "Συστατικά",
                  icon: <FlaskConical />,
                  view: item.composition ? <div className="rounded-xl border border-border/70 bg-card p-5"><CompositionDetails composition={item.composition} /></div> : (
                    <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
                      <FlaskConical className="mx-auto size-6 text-muted-foreground" />
                      <h3 className="mt-3 text-sm font-semibold">Δεν έχει καταχωρηθεί σύσταση</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Συμπλήρωσε συστατικά, ποσοστά και αλλεργιογόνα από την καρτέλα του είδους.</p>
                      <Link href={`/platform/catalog/${item.id}#composition`} className={btn("outline", "sm", "mt-4")}>Προσθήκη συστατικών <ArrowUpRight /></Link>
                    </div>
                  ),
                }],
                edit: <CategoryMatchEditor itemId={item.id} categoryId={match.categoryId} manufacturerId={item.brand?.manufacturer.id ?? ""} brandId={item.brand?.id ?? ""} categoryOptions={editCategoryOptions} manufacturerOptions={manufacturerOptions} brandOptions={brandOptions} />,
              },
              menu: (
                <>
                  <Link href={`/platform/catalog/${item.id}`} role="menuitem" className={menuItem}><ArrowUpRight /> Άνοιγμα είδους</Link>
                  <Link href={`/platform/catalog/${item.id}#composition`} role="menuitem" className={menuItem}><FlaskConical /> Συστατικά{item.composition ? " ✓" : ""}</Link>
                </>
              ),
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
