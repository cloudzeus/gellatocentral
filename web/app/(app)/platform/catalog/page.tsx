import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { BarcodeField } from "@/components/barcode-field";
import { Files } from "@/components/files";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveBrand, saveManufacturer, saveTradeCategory, saveTradeItem, toggleTradeCategory, toggleTradeItem } from "./actions";

// Ο κεντρικός κατάλογος εμπορικών ειδών: κατηγορίες, κατασκευαστές/brands και είδη με EAN, συσκευασία και φωτογραφία.
// Τα βρίσκουν όλοι οι συνδρομητές με σάρωση ή αναζήτηση — δεν τα ξανακαταχωρούν (docs/analysis/PROCUREMENT-DESIGN.md).
export default async function CatalogPage({ searchParams }: PageProps<"/platform/catalog">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const term = typeof q.q === "string" ? q.q.trim() : "";
  // Ο κατάλογος μεγαλώνει από την εισαγωγή Open Food Facts — η λίστα φιλτράρεται και κόβεται, δεν φορτώνεται όλη.
  const itemWhere = { orgId: null, ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { ean: { contains: term } }] } : {}) };
  const [categories, manufacturers, items, itemsTotal, units] = await Promise.all([
    db.tradeCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { children: { orderBy: { name: "asc" } } }, where: { parentId: null } }),
    db.manufacturer.findMany({ orderBy: { name: "asc" }, include: { brands: { orderBy: { name: "asc" } } } }),
    db.tradeItem.findMany({ where: itemWhere, orderBy: { name: "asc" }, take: 200, include: { brand: { include: { manufacturer: true } }, category: true, contentUnit: true, composition: { select: { id: true } } } }),
    db.tradeItem.count({ where: { orgId: null } }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
  ]);
  const brandOptions: [string, string][] = manufacturers.flatMap((m): [string, string][] => m.brands.map((b): [string, string] => [b.id, `${m.name} · ${b.name}`]));
  const categoryOptions: [string, string][] = categories.flatMap((c): [string, string][] => [[c.id, c.name], ...c.children.map((ch): [string, string] => [ch.id, `${c.name} › ${ch.name}`])]);

  const categoryForm = (c?: { id: string; name: string; parentId: string | null }) => (
    <form key={c?.id ?? "new"} action={saveTradeCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={c?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={c?.name} hint="π.χ. Γαλακτοκομικά" />
      <Select label="Ανήκει σε" name="parentId" defaultValue={c?.parentId ?? ""} options={[["", "— Κορυφαίο επίπεδο —"], ...categories.filter((p) => p.id !== c?.id).map((p): [string, string] => [p.id, p.name])]} />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const brandForm = () => (
    <form action={saveBrand} className="grid gap-4 [&>button]:justify-self-end">
      <Select label="Κατασκευαστής" name="manufacturerId" required options={manufacturers.map((m): [string, string] => [m.id, m.name])} />
      <Field label="Brand" name="name" required minLength={2} maxLength={80} hint="π.χ. ΤΩΝ 150" />
      <Submit className={btn("default")}>Προσθήκη</Submit>
    </form>
  );

  const itemForm = (t?: (typeof items)[number]) => (
    <form key={t?.id ?? "new"} action={saveTradeItem} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="itemId" value={t?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={t?.name} hint="π.χ. Γάλα φρέσκο 1,5% 1L" />
      <BarcodeField label="EAN / GTIN" name="ean" defaultValue={t?.ean ?? ""} hint="Σάρωση ή 8–14 ψηφία — μοναδικό στον κεντρικό κατάλογο" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Κατηγορία" name="categoryId" defaultValue={t?.categoryId ?? ""} options={[["", "—"] as [string, string], ...categoryOptions]} />
        <Select label="Brand" name="brandId" defaultValue={t?.brandId ?? ""} options={[["", "—"], ...brandOptions]} />
      </div>
      <Field label="Συσκευασία" name="packaging" maxLength={80} defaultValue={t?.packaging ?? ""} hint="π.χ. χαρτοκιβώτιο, πλαστικό μπουκάλι" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Περιεχόμενο" name="contentAmount" required inputMode="decimal" defaultValue={t ? String(t.contentQty / t.contentUnit.toBase).replace(".", ",") : ""} hint="Στη μονάδα δίπλα, π.χ. 1,5" />
        <Select label="Μονάδα" name="contentUnitId" defaultValue={t?.contentUnitId ?? ""} options={units.map((u): [string, string] => [u.id, u.nameEL])} />
      </div>
      <Field label="Οικογένεια" name="familyCode" maxLength={40} defaultValue={t?.familyCode ?? ""} hint="π.χ. DELTA-GA-1.5 — ομαδοποιεί το ίδιο είδος σε 1L, 1,5L…" />
      <Submit className={btn("default")}>{t ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      {t ? (
        <div className="border-t border-border/70 pt-4">
          <p className="mb-2 text-sm font-medium">Φωτογραφία</p>
          <Files orgId={null} category="trade_item" refType="tradeItem" refId={t.id} empty="Καμία φωτογραφία ακόμα" />
        </div>
      ) : null}
    </form>
  );

  return (
    <Page section="Common Tables" title="Κατάλογος ειδών" description="Τα συσκευασμένα είδη που βρίσκουν όλοι οι συνδρομητές με EAN ή όνομα, με brand, συσκευασία και φωτογραφία">
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Ο κατάλογος ενημερώθηκε</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Είδη</h2><p className="text-sm text-muted-foreground">{itemsTotal ? `${itemsTotal.toLocaleString("el-GR")} στον κατάλογο${term ? ` · ${items.length} για «${term}»` : itemsTotal > items.length ? ` · εμφανίζονται ${items.length}` : ""}` : "Κανένα είδος ακόμα"}</p></div>
            <form className="flex gap-1">
              <input name="q" defaultValue={term} placeholder="Όνομα ή EAN…" className="h-7.5 w-48 rounded-lg border border-input bg-card px-2.5 text-xs" />
              <Submit className={btn("outline", "sm")}>Αναζήτηση</Submit>
            </form>
            <Modal label={<><Plus /> Νέο είδος</>} size="sm" title="Νέο είδος καταλόγου">{itemForm()}</Modal>
          </div>
          {items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Όνομα</th><th className="px-3 py-2 font-semibold">EAN</th><th className="px-3 py-2 font-semibold">Κατηγορία</th><th className="px-3 py-2 font-semibold">Brand</th><th className="px-3 py-2 text-right font-semibold">Περιεχόμενο</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className={cn("border-t border-border/70", t.active ? "" : "text-muted-foreground")}>
                      <td className="px-5 py-2 font-medium">
                        <span className="flex items-center gap-2">
                          {t.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- έρχεται από το CDN του Bunny, όχι από τον optimizer του Next
                            <img src={t.imageUrl} alt="" className="size-8 shrink-0 rounded-md border border-border/60 object-cover" loading="lazy" />
                          ) : null}
                          <span>{t.name}{t.packaging ? <span className="block text-xs font-normal text-muted-foreground">{t.packaging}</span> : null}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{t.ean ?? "—"}</td>
                      <td className="px-3 py-2">{t.category ? (t.category.parentId ? "— " : "") + t.category.name : "—"}</td>
                      <td className="px-3 py-2">{t.brand ? `${t.brand.manufacturer.name} · ${t.brand.name}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(t.contentQty / t.contentUnit.toBase).toLocaleString("el-GR")} {t.contentUnit.code}</td>
                      <td className="px-3 py-2">{t.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}</td>
                      <td className="px-5 py-1.5"><span className="flex justify-end gap-1"><Link href={`/platform/catalog/${t.id}`} className={btn("ghost", "sm")}><FlaskConical /> {t.composition ? "Σύσταση ✓" : "Σύσταση"}</Link><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={t.name}>{itemForm(t)}</Modal><form action={toggleTradeItem.bind(null, t.id)}><Submit className={btn("ghost", "sm")}>{t.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένα είδος ακόμα. Πρόσθεσε το πρώτο με «Νέο είδος» — βοηθά να έχουν μπει κατηγορίες και brands</p>}
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

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Κατασκευαστές & brands</h2><p className="text-sm text-muted-foreground">{manufacturers.length ? `${manufacturers.length} κατασκευαστές, ${manufacturers.reduce((n, m) => n + m.brands.length, 0)} brands` : "Κανένας κατασκευαστής ακόμα"}</p></div>
            <div className="flex gap-1">
              <Modal label={<><Plus /> Κατασκευαστής</>} size="sm" title="Νέος κατασκευαστής">
                <form action={saveManufacturer} className="grid gap-4 [&>button]:justify-self-end">
                  <Field label="Όνομα" name="name" required minLength={2} maxLength={80} hint="π.χ. ΔΕΛΤΑ, ΦΑΓΕ" />
                  <Submit className={btn("default")}>Προσθήκη</Submit>
                </form>
              </Modal>
              {manufacturers.length ? <Modal label={<><Plus /> Brand</>} size="sm" title="Νέο brand">{brandForm()}</Modal> : null}
            </div>
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
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένας κατασκευαστής ακόμα</p>}
        </Card>

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
