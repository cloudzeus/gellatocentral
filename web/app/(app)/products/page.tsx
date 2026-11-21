import { FolderPlus, Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { saveCategory, saveProduct, toggleProduct } from "./actions";

// Ο κατάλογος του ταμείου: κατηγορίες με τα προϊόντα τους, τιμή με ΦΠΑ και συντελεστής από τους κοινούς της πλατφόρμας.
export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const { org, can } = await currentOrg("products.read");
  const q = await searchParams;
  const [categories, vatRates] = await Promise.all([
    db.category.findMany({ where: { orgId: org.id }, orderBy: [{ position: "asc" }, { name: "asc" }], include: { products: { orderBy: { name: "asc" }, include: { vatRate: true } } } }),
    db.vatRate.findMany({ where: { active: true }, orderBy: { rate: "desc" } }),
  ]);
  const fallbackRate = vatRates.find((v) => v.rate === 13) ?? vatRates[0];

  const categoryForm = (c?: (typeof categories)[number]) => (
    <form key={c?.name ?? "new"} action={saveCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={c?.id ?? ""} />
      <Field label="Όνομα κατηγορίας" name="name" required minLength={2} maxLength={40} defaultValue={c?.name} hint="π.χ. Παγωτό, Γλυκά, Καφές" />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const productForm = (categoryId: string, p?: (typeof categories)[number]["products"][number]) => {
    // οι ενεργοί συντελεστές· σε επεξεργασία μπαίνει και ο τρέχων, ακόμα κι αν έχει κρυφτεί
    const options = p && !vatRates.some((v) => v.id === p.vatRateId) ? [...vatRates, p.vatRate] : vatRates;
    return (
      <form key={p ? `${p.name}-${p.priceCents}` : `new-${categoryId}`} action={saveProduct} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="productId" value={p?.id ?? ""} />
        <input type="hidden" name="categoryId" value={categoryId} />
        <Field label="Όνομα" name="name" required minLength={2} maxLength={60} defaultValue={p?.name} hint="Όπως θα εμφανίζεται στο ταμείο και την απόδειξη" />
        <Field label="Τιμή με ΦΠΑ (€)" name="price" required inputMode="decimal" defaultValue={p ? (p.priceCents / 100).toFixed(2).replace(".", ",") : ""} hint="π.χ. 4,50 — η τελική τιμή που πληρώνει ο πελάτης" />
        <Select label="Συντελεστής ΦΠΑ" name="vatRateId" defaultValue={p?.vatRateId ?? fallbackRate?.id} options={options.map((v): [string, string] => [v.id, `${v.name} ${v.rate}%`])} />
        <Submit className={btn("default")}>{p ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Συνταγολόγιο" title="Προϊόντα" description="Ο κατάλογος του ταμείου: τιμές με ΦΠΑ και συντελεστής ανά προϊόν. Τα κρυμμένα δεν εμφανίζονται στο ταμείο"
      actions={can("products.add") ? <Modal label={<><FolderPlus /> Νέα κατηγορία</>} size="sm" title="Νέα κατηγορία">{categoryForm()}</Modal> : null}>
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Ο κατάλογος ενημερώθηκε</p> : null}
        {categories.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Καμία κατηγορία ακόμα. Ξεκίνα με «Νέα κατηγορία» και μετά πρόσθεσε τα προϊόντα της</Card>
        ) : null}
        {categories.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1"><h2 className="text-lg">{c.name}</h2><p className="text-sm text-muted-foreground">{c.products.length ? `${c.products.filter((p) => p.active).length} ενεργά από ${c.products.length}` : "Χωρίς προϊόντα"}</p></div>
              {can("products.edit") ? <Modal label={<><Pencil /> Μετονομασία</>} size="sm" title={`Κατηγορία: ${c.name}`}>{categoryForm(c)}</Modal> : null}
              {can("products.add") ? <Modal label={<><Plus /> Νέο προϊόν</>} size="sm" title={`Νέο προϊόν: ${c.name}`}>{productForm(c.id)}</Modal> : null}
            </div>
            {c.products.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Όνομα</th><th className="px-3 py-2 text-right font-semibold">Τιμή</th><th className="px-3 py-2 font-semibold">ΦΠΑ</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                  <tbody>
                    {c.products.map((p) => (
                      <tr key={p.id} className={cn("border-t border-border/70", p.active ? "" : "text-muted-foreground")}>
                        <td className="px-5 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{euro(p.priceCents)}</td>
                        <td className="px-3 py-2">{p.vatRate.name} {p.vatRate.rate}%</td>
                        <td className="px-3 py-2">{p.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}</td>
                        <td className="px-5 py-1.5">
                          <span className="flex justify-end gap-1">
                            {can("products.edit") ? <><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={p.name}>{productForm(c.id, p)}</Modal><form action={toggleProduct.bind(null, p.id)}><Submit className={btn("ghost", "sm")}>{p.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένα προϊόν σε αυτή την κατηγορία ακόμα</p>}
          </Card>
        ))}
        <p className="text-xs text-muted-foreground">Ένα προϊόν δεν σβήνεται, μόνο κρύβεται από το ταμείο: οι αποδείξεις που έχουν εκδοθεί κρατούν τη τιμή και τον ΦΠΑ της στιγμής τους</p>
      </div>
    </Page>
  );
}
