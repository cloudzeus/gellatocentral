import { FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { getProductPageData } from "@/lib/product-catalog";
import { activateProducts, deleteProduct, deleteProducts, hideProducts, saveCategory, saveProduct, toggleProduct } from "./actions";

// Ο κατάλογος του ταμείου: server-side φίλτρα και προσαρμόσιμες στήλες, με την επεξεργασία μέσα στη γραμμή.
export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const { org, can } = await currentOrg("products.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "category", "price", "vat", "status"]);
  // Τα κρυφά βγαίνουν από την καθημερινή λίστα· παραμένουν διαθέσιμα από το φίλτρο κατάστασης.
  const status = filterParam(q, "status", ["active", "hidden"]) ?? "active";
  const { categories, vatRates, category, products, total } = await getProductPageData({
    orgId: org.id,
    q: list.q,
    categoryParam: typeof q.category === "string" ? q.category : "",
    status,
    sort: list.sort,
    direction: list.sort ? list.dir : "asc",
    skip: list.skip,
    take: list.take,
  });
  const fallbackRate = vatRates.find((v) => v.rate === 13) ?? vatRates[0];

  const categoryForm = (c?: (typeof categories)[number]) => (
    <form key={c?.id ?? "new"} action={saveCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={c?.id ?? ""} />
      <Field label="Όνομα κατηγορίας" name="name" required minLength={2} maxLength={40} defaultValue={c?.name} hint="π.χ. Παγωτό, Γλυκά, Καφές" />
      <FormPending label="Αποθήκευση κατηγορίας…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const productForm = (p?: (typeof products)[number]) => {
    const options = p && !vatRates.some((v) => v.id === p.vatRateId) ? [...vatRates, p.vatRate] : vatRates;
    return (
      <form key={p?.id ?? "new"} action={saveProduct} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="productId" value={p?.id ?? ""} />
        <Field label="Όνομα" name="name" required minLength={2} maxLength={60} defaultValue={p?.name} hint="Όπως θα εμφανίζεται στο ταμείο και την απόδειξη" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Κατηγορία" name="categoryId" required defaultValue={p?.categoryId ?? categories[0]?.id} options={categories.map((c): [string, string] => [c.id, c.name])} />
          <Select label="Συντελεστής ΦΠΑ" name="vatRateId" defaultValue={p?.vatRateId ?? fallbackRate?.id} options={options.map((v): [string, string] => [v.id, `${v.name} ${v.rate}%`])} />
        </div>
        <Field label="Τιμή με ΦΠΑ (€)" name="price" required inputMode="decimal" defaultValue={p ? (p.priceCents / 100).toFixed(2).replace(".", ",") : ""} hint="π.χ. 4,50 — η τελική τιμή που πληρώνει ο πελάτης" />
        <FormPending label="Αποθήκευση προϊόντος…" />
        <Submit pendingText="Αποθήκευση…" className={btn("default")}>{p ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Συνταγολόγιο" title="Προϊόντα" description="Ο κατάλογος του ταμείου: τιμές με ΦΠΑ και συντελεστής ανά προϊόν. Τα κρυμμένα δεν εμφανίζονται στο ταμείο"
      actions={can("products.add") ? <span className="flex flex-wrap gap-2"><Modal label={<><FolderPlus /> Νέα κατηγορία</>} size="sm" title="Νέα κατηγορία">{categoryForm()}</Modal>{categories.length ? <Modal wide label={<><Plus /> Νέο προϊόν</>} size="sm" title="Νέο προϊόν">{productForm()}</Modal> : null}</span> : null}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Ο κατάλογος ενημερώθηκε</p> : null}
        {q.deleted ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το προϊόν διαγράφηκε οριστικά</p> : null}
        {q.hidden ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Το προϊόν έχει πωλήσεις, οπότε αποκρύφτηκε αντί να διαγραφεί</p> : null}
        <Card>
          <DataTable
            id="products"
            bulkActions={can("products.edit") ? [
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateProducts },
              { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων προϊόντων από το ταμείο;", run: hideProducts },
              { value: "delete", label: "Διαγραφή επιλεγμένων", confirm: "Τα προϊόντα χωρίς πωλήσεις θα διαγραφούν οριστικά. Όσα έχουν πωλήσεις θα αποκρυφτούν για να μείνει ανέπαφο το ιστορικό. Να συνεχιστεί;", run: deleteProducts },
            ] : []}
            listing={{ ...list, total, placeholder: "Προϊόν ή κατηγορία…", filters: [
              { key: "category", label: "Κατηγορία", value: category, options: categories.map((c): [string, string] => [c.id, c.name]) },
              { key: "status", label: "Κατάσταση", value: status, showAll: false, options: [["active", "Ενεργά"], ["hidden", "Κρυφά"]] },
            ] }}
            empty={categories.length ? "Κανένα προϊόν ακόμα. Πρόσθεσε το πρώτο με «Νέο προϊόν»" : "Καμία κατηγορία ακόμα. Ξεκίνα με «Νέα κατηγορία»"}
            columns={[
              { key: "name", label: "Προϊόν", required: true, sortable: true },
              { key: "category", label: "Κατηγορία", sortable: true },
              { key: "price", label: "Τιμή", numeric: true, sortable: true },
              { key: "vat", label: "ΦΠΑ", sortable: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={products.map((p) => ({
              id: p.id,
              cells: {
                name: <span className="font-semibold">{p.name}</span>,
                category: p.category.name,
                price: euro(p.priceCents),
                vat: `${p.vatRate.name} ${p.vatRate.rate}%`,
                status: p.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>,
              },
              details: {
                label: p.name,
                view: <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Κατηγορία</dt><dd className="font-medium">{p.category.name}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Τιμή με ΦΠΑ</dt><dd className="font-medium tabular-nums">{euro(p.priceCents)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Συντελεστής</dt><dd className="font-medium">{p.vatRate.name} {p.vatRate.rate}%</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Εμφάνιση στο ταμείο</dt><dd className="font-medium">{p.active ? "Ενεργό" : "Κρυφό"}</dd></div>
                </dl>,
                edit: can("products.edit") ? productForm(p) : undefined,
              },
              menu: can("products.edit") ? (
                <>
                  <form action={toggleProduct.bind(null, p.id)}><Submit className={menuItem}>{p.active ? "Απόκρυψη από το ταμείο" : "Εμφάνιση ξανά"}</Submit></form>
                  <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${p.name}`} description="Αν υπάρχουν πωλήσεις, το προϊόν θα αποκρυφτεί αντί να διαγραφεί.">
                    <form action={deleteProduct.bind(null, p.id)} className="grid gap-4 [&>button]:justify-self-end">
                      <p className="text-sm text-muted-foreground">Χωρίς ιστορικό πωλήσεων η διαγραφή είναι οριστική και δεν αναιρείται.</p>
                      <Submit pendingText="Διαγραφή…" className={btn("destructive")}><Trash2 /> Διαγραφή προϊόντος</Submit>
                    </form>
                  </Modal>
                </>
              ) : undefined,
            }))}
          />
        </Card>
        {categories.length ? (
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Κατηγορίες</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {categories.map((c) => can("products.edit") ? <Modal key={c.id} label={<><Pencil /> {c.name}</>} size="sm" title={`Κατηγορία: ${c.name}`}>{categoryForm(c)}</Modal> : <Badge key={c.id}>{c.name}</Badge>)}
            </div>
          </Card>
        ) : null}
        <p className="text-xs text-muted-foreground">Τα προϊόντα χωρίς πωλήσεις διαγράφονται οριστικά. Όσα έχουν πουληθεί αποκρύπτονται, ώστε οι αποδείξεις να κρατούν την τιμή και τον ΦΠΑ της στιγμής τους· τα βρίσκεις από το φίλτρο «Κατάσταση: Κρυφά»</p>
      </div>
    </Page>
  );
}
