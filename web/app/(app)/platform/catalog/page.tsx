import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, menuItem, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { saveBrand, saveManufacturer, saveTradeCategory, toggleTradeCategory, toggleTradeItem } from "./actions";
import { ItemForm } from "./item-form";

// Ο κεντρικός κατάλογος εμπορικών ειδών: κατηγορίες, κατασκευαστές/brands και είδη με EAN, συσκευασία και φωτογραφία.
// Τα βρίσκουν όλοι οι συνδρομητές με σάρωση ή αναζήτηση — δεν τα ξανακαταχωρούν (docs/analysis/PROCUREMENT-DESIGN.md).
// Ο κατάλογος μεγαλώνει από την εισαγωγή Open Food Facts: η λίστα δουλεύει με αναζήτηση και σελιδοποίηση στον
// server (DataTable), και η επεξεργασία γίνεται στην καρτέλα του είδους — ποτέ φόρμες ανά γραμμή στη λίστα.
export default async function CatalogPage({ searchParams }: PageProps<"/platform/catalog">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "ean"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const like = { contains: list.q, mode: "insensitive" as const };
  const itemWhere = {
    orgId: null,
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [{ name: like }, { ean: { contains: list.q } }] } : {}),
  };
  const [categories, brands, items, itemsTotal, units] = await Promise.all([
    db.tradeCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { children: { orderBy: { name: "asc" } } }, where: { parentId: null } }),
    // οι επιλογές brand της φόρμας: επίπεδη λίστα με τον κατασκευαστή (όχι όλο το δέντρο)
    db.brand.findMany({ orderBy: { name: "asc" }, include: { manufacturer: true } }),
    db.tradeItem.findMany({
      where: itemWhere,
      orderBy: list.sort === "ean" ? { ean: list.dir } : { name: list.dir },
      skip: list.skip,
      take: list.take,
      include: { brand: { include: { manufacturer: true } }, category: true, contentUnit: true, composition: { select: { id: true } } },
    }),
    db.tradeItem.count({ where: itemWhere }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
  ]);
  const brandOptions: [string, string][] = brands.map((b): [string, string] => [b.id, `${b.manufacturer.name} · ${b.name}`]);
  const categoryOptions: [string, string][] = categories.flatMap((c): [string, string][] => [[c.id, c.name], ...c.children.map((ch): [string, string] => [ch.id, `${c.name} › ${ch.name}`])]);

  const categoryForm = (c?: { id: string; name: string; parentId: string | null }) => (
    <form key={c?.id ?? "new"} action={saveTradeCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={c?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={c?.name} hint="π.χ. Γαλακτοκομικά" />
      <Select label="Ανήκει σε" name="parentId" defaultValue={c?.parentId ?? ""} options={[["", "— Κορυφαίο επίπεδο —"], ...categories.filter((p) => p.id !== c?.id).map((p): [string, string] => [p.id, p.name])]} />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Common Tables" title="Κατάλογος ειδών" description="Τα συσκευασμένα είδη που βρίσκουν όλοι οι συνδρομητές με EAN ή όνομα, με brand, συσκευασία και φωτογραφία"
      actions={
        <Modal label={<><Plus /> Νέο είδος</>} variant="default" size="sm" title="Νέο είδος καταλόγου">
          <ItemForm categoryOptions={categoryOptions} brandOptions={brandOptions} units={units} />
        </Modal>
      }>
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Ο κατάλογος ενημερώθηκε</p> : null}

        <Card>
          <DataTable
            id="catalog"
            listing={{
              ...list,
              total: itemsTotal,
              placeholder: "Όνομα ή EAN…",
              filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"]] }],
            }}
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
                  <>
                    <span className="flex items-center gap-2">
                      {t.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- έρχεται από το CDN του Bunny, όχι από τον optimizer του Next
                        <img src={t.imageUrl} alt="" className="size-8 shrink-0 rounded-md border border-border/60 object-cover" loading="lazy" />
                      ) : null}
                      <span>
                        <Link href={`/platform/catalog/${t.id}`} className="font-semibold underline-offset-2 hover:underline">{t.name}</Link>
                        {t.packaging ? <span className="block text-xs text-muted-foreground">{t.packaging}</span> : null}
                      </span>
                    </span>
                  </>
                ),
                ean: <span className="tabular-nums">{t.ean ?? "—"}</span>,
                category: t.category ? (t.category.parentId ? "— " : "") + t.category.name : "—",
                brand: t.brand ? `${t.brand.manufacturer.name} · ${t.brand.name}` : "—",
                content: <span className="tabular-nums">{(t.contentQty / t.contentUnit.toBase).toLocaleString("el-GR")} {t.contentUnit.code}</span>,
                status: t.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>,
              },
              menu: (
                <>
                  <Link href={`/platform/catalog/${t.id}`} role="menuitem" className={menuItem}><Pencil /> Άνοιγμα και αλλαγή</Link>
                  <Link href={`/platform/catalog/${t.id}#composition`} role="menuitem" className={menuItem}><FlaskConical /> Σύσταση{t.composition ? " ✓" : ""}</Link>
                  <form action={toggleTradeItem.bind(null, t.id)}>
                    <Submit className={menuItem}>{t.active ? "Απόκρυψη από τους συνδρομητές" : "Εμφάνιση ξανά"}</Submit>
                  </form>
                </>
              ),
            }))}
          />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Κατηγορίες</h2><p className="text-sm text-muted-foreground">Δέντρο δύο επιπέδων, κοινό για όλους τους συνδρομητές</p></div>
            <Modal label={<><Plus /> Νέα κατηγορία</>} size="sm" title="Νέα κατηγορία">{categoryForm()}</Modal>
          </div>
          {categories.length ? (
            <ul className="divide-y divide-border/70">
              {categories.map((c) => (
                <li key={c.id} className={cn("px-5 py-3", c.active ? "" : "text-muted-foreground")}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium">{c.name}</span>
                    <Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={c.name}>{categoryForm(c)}</Modal>
                    <form action={toggleTradeCategory.bind(null, c.id)}><Submit className={btn("ghost", "sm")}>{c.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>
                  </div>
                  {c.children.length ? (
                    <ul className="mt-2 grid gap-1">
                      {c.children.map((ch) => (
                        <li key={ch.id} className={cn("flex items-center gap-2 text-sm", ch.active ? "" : "text-muted-foreground")}>
                          <span className="flex-1 pl-4">› {ch.name}</span>
                          <Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={ch.name}>{categoryForm({ id: ch.id, name: ch.name, parentId: ch.parentId })}</Modal>
                          <form action={toggleTradeCategory.bind(null, ch.id)}><Submit className={btn("ghost", "sm")}>{ch.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία κατηγορία ακόμα</p>}
        </Card>

        <ManufacturersCard mq={typeof q.mq === "string" ? q.mq.trim() : ""} />

        <p className="px-1 text-xs text-muted-foreground">
          Περιέχει δεδομένα από{" "}
          <a href="https://gr.openfoodfacts.org" target="_blank" rel="noreferrer" className="underline">Open Food Facts</a>,
          διαθέσιμα υπό την{" "}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer" className="underline">Open Database License (ODbL)</a>{" "}
          · φωτογραφίες CC-BY-SA. Οι εικόνες των ειδών φιλοξενούνται στο Bunny της πλατφόρμας.
        </p>
      </div>
    </Page>
  );
}

/**
 * Κατασκευαστές & brands. Μετά την εισαγωγή OFF είναι χιλιάδες, οπότε δεν φορτώνονται όλοι:
 * αναζήτηση στον server (?mq=) και το πολύ 50 αποτελέσματα· χωρίς όρο φαίνονται μόνο οι πρώτοι αλφαβητικά.
 */
async function ManufacturersCard({ mq }: { mq: string }) {
  const where = mq ? { name: { contains: mq, mode: "insensitive" as const } } : {};
  const [manufacturers, total] = await Promise.all([
    db.manufacturer.findMany({ where, orderBy: { name: "asc" }, take: 50, include: { brands: { orderBy: { name: "asc" }, take: 12 } } }),
    db.manufacturer.count({ where }),
  ]);

  const brandForm = () => (
    <form action={saveBrand} className="grid gap-4 [&>button]:justify-self-end">
      <Select label="Κατασκευαστής" name="manufacturerId" required options={manufacturers.map((m): [string, string] => [m.id, m.name])} />
      <Field label="Brand" name="name" required minLength={2} maxLength={80} hint="π.χ. ΤΩΝ 150" />
      <Submit className={btn("default")}>Προσθήκη</Submit>
    </form>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">Κατασκευαστές & brands</h2>
          <p className="text-sm text-muted-foreground">
            {total ? `${total.toLocaleString("el-GR")} κατασκευαστές${total > manufacturers.length ? ` · εμφανίζονται ${manufacturers.length}` : ""}` : "Κανένας κατασκευαστής ακόμα"}
          </p>
        </div>
        <form className="flex gap-1">
          <input name="mq" defaultValue={mq} placeholder="Όνομα κατασκευαστή…" className="h-7.5 w-44 rounded-lg border border-input bg-card px-2.5 text-xs" />
          <Submit className={btn("outline", "sm")}>Αναζήτηση</Submit>
        </form>
        <Link href="/platform/catalog/duplicates" className={btn("outline", "sm")}>Διπλότυπα</Link>
        <Modal label={<><Plus /> Κατασκευαστής</>} size="sm" title="Νέος κατασκευαστής">
          <form action={saveManufacturer} className="grid gap-4 [&>button]:justify-self-end">
            <Field label="Όνομα" name="name" required minLength={2} maxLength={80} hint="π.χ. ΔΕΛΤΑ, ΦΑΓΕ" />
            <Submit className={btn("default")}>Προσθήκη</Submit>
          </form>
        </Modal>
        {manufacturers.length ? <Modal label={<><Plus /> Brand</>} size="sm" title="Νέο brand">{brandForm()}</Modal> : null}
      </div>
      {manufacturers.length ? (
        <ul className="divide-y divide-border/70">
          {manufacturers.map((m) => (
            <li key={m.id} className="px-5 py-3">
              <span className="font-medium">{m.name}</span>
              {m.brands.length ? <span className="ml-2 text-sm text-muted-foreground">{m.brands.map((b) => b.name).join(", ")}</span> : <span className="ml-2 text-sm text-muted-foreground">χωρίς brands</span>}
            </li>
          ))}
        </ul>
      ) : <p className="px-5 py-6 text-sm text-muted-foreground">{mq ? `Κανένας κατασκευαστής για «${mq}»` : "Κανένας κατασκευαστής ακόμα"}</p>}
    </Card>
  );
}
