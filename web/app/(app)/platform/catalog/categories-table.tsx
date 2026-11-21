import { Pencil, Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, menuItem, Select } from "@/components/ui";
import { filterParam } from "@/lib/paging";
import { activateTradeCategories, deleteTradeCategory, hideTradeCategories, saveTradeCategory, toggleTradeCategory } from "./actions";

type Category = { id: string; name: string; parentId: string | null; active: boolean };
export type CatalogCategory = Category & { children: Category[] };

/** Το δέντρο κατηγοριών ως πλήρης πίνακας, χωρίς client αρχικά δεδομένα ή mutations. */
export function CategoriesTable({ categories, searchParams }: { categories: CatalogCategory[]; searchParams: Record<string, string | string[] | undefined> }) {
  const sort = filterParam(searchParams, "csort", ["name", "level", "status"]);
  const dir = filterParam(searchParams, "cdir", ["asc", "desc"]) ?? "desc";
  const rows = categories.flatMap((c) => [
    { ...c, level: 0, parentName: "—", childCount: c.children.length },
    ...c.children.map((ch) => ({ ...ch, level: 1, parentName: c.name, childCount: 0 })),
  ]);
  if (sort) {
    const direction = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const result = sort === "level" ? a.level - b.level : sort === "status" ? Number(a.active) - Number(b.active) : a.name.localeCompare(b.name, "el");
      return result * direction || a.name.localeCompare(b.name, "el");
    });
  }

  const form = (c?: Category) => (
    <form action={saveTradeCategory} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="categoryId" value={c?.id ?? ""} />
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={c?.name} hint="π.χ. Γαλακτοκομικά" />
      <Select label="Ανήκει σε" name="parentId" defaultValue={c?.parentId ?? ""} options={[["", "— Κορυφαίο επίπεδο —"], ...categories.filter((p) => p.id !== c?.id).map((p): [string, string] => [p.id, p.name])]} />
      <Submit className={btn("default")}>{c ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0 flex-1"><h2 className="text-lg">Κατηγορίες</h2><p className="text-sm text-muted-foreground">Δέντρο δύο επιπέδων, κοινό για όλους τους συνδρομητές</p></div>
        <Modal label={<><Plus /> Νέα κατηγορία</>} size="sm" title="Νέα κατηγορία">{form()}</Modal>
      </div>
      <DataTable
        id="catalog-categories"
        listing={{ q: "", page: 1, pageSize: Math.max(1, rows.length), total: rows.length, placeholder: "", showSearch: false, sort, dir, keys: { sort: "csort", dir: "cdir" }, params: { tab: "categories" } }}
        bulkActions={[
          { value: "activate", label: "Εμφάνιση κατηγοριών", run: activateTradeCategories },
          { value: "hide", label: "Απόκρυψη κατηγοριών", run: hideTradeCategories, confirm: "Να αποκρυφτούν οι επιλεγμένες κατηγορίες;" },
        ]}
        empty="Καμία κατηγορία ακόμα"
        columns={[
          { key: "name", label: "Όνομα", required: true, sortable: true },
          { key: "level", label: "Επίπεδο", sortable: true },
          { key: "parent", label: "Ανήκει σε" },
          { key: "children", label: "Υποκατηγορίες", numeric: true },
          { key: "status", label: "Κατάσταση", sortable: true },
        ]}
        rows={rows.map((c) => ({
          id: c.id,
          cells: {
            name: <span className="font-medium">{c.level ? "› " : ""}{c.name}</span>,
            level: c.level ? "Υποκατηγορία" : "Κορυφαίο",
            parent: c.parentName,
            children: c.childCount,
            status: c.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Κρυφή</Badge>,
          },
          details: {
            label: c.name,
            view: <p className="text-sm text-muted-foreground">{c.level ? `Υποκατηγορία της «${c.parentName}».` : `Κορυφαία κατηγορία με ${c.childCount} υποκατηγορίες.`}</p>,
            edit: form(c),
          },
          menu: (
            <>
              <Modal menuItem label={<><Pencil /> Αλλαγή</>} title={`Αλλαγή: ${c.name}`}>{form(c)}</Modal>
              <form action={toggleTradeCategory.bind(null, c.id)}><Submit className={menuItem}>{c.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>
              <Modal menuItem label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${c.name}`} description="Επιτρέπεται μόνο χωρίς υποκατηγορίες και συνδεδεμένα είδη.">
                <form action={deleteTradeCategory.bind(null, c.id)} className="grid gap-4">
                  <p className="text-sm text-muted-foreground">Η κατηγορία θα διαγραφεί οριστικά. Η ενέργεια δεν αναιρείται.</p>
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
