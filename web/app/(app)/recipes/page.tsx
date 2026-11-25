import Link from "next/link";
import { ChefHat, Eye, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { DetailGrid, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { RECIPE_TYPES, analyzeRecipe } from "@/lib/recipe-analysis";
import { recipeEditorItems } from "@/lib/recipe-data";
import { saveRecipe } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

// Συνταγές παγωτού: η τεχνική ανάλυση και η αναζήτηση μένουν στον server, ο πίνακας αλλάζει μόνο την παρουσίαση.
export default async function RecipesPage({ searchParams }: PageProps<"/recipes">) {
  const { org, can } = await currentOrg("recipes.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["name", "type", "product", "items", "status"]);
  const type = filterParam(q, "type", RECIPE_TYPES.map((t) => t.value));
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    orgId: org.id,
    ...(type ? { type } : {}),
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" as const } }, { product: { name: { contains: list.q, mode: "insensitive" as const } } }] } : {}),
  };
  const direction = list.sort ? list.dir : "asc";
  const orderBy = list.sort === "type" ? { type: direction }
    : list.sort === "product" ? { product: { name: direction } }
      : list.sort === "items" ? { items: { _count: direction } }
        : list.sort === "status" ? { active: direction }
          : list.sort === "name" ? { name: direction }
            : [{ active: "desc" as const }, { name: "asc" as const }];
  const [recipes, total, items, products, outputItems] = await Promise.all([
    db.recipe.findMany({ where, orderBy, skip: list.skip, take: list.take, include: { items: { include: { genericItem: true } }, product: { select: { name: true } }, _count: { select: { items: true } } } }),
    db.recipe.count({ where }),
    recipeEditorItems(org.id),
    db.product.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.genericItem.findMany({ where: { orgId: org.id, active: true, trackStock: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const analysisById = new Map(recipes.map((r) => [r.id, analyzeRecipe(
    r.items.map((l) => {
      const item = byId.get(l.genericItemId);
      return { grams: l.grams, material: { ...(item?.composition ?? {}), costHundredthsPerGram: item?.costHundredthsPerGram ?? 0 } };
    }),
    r.type,
  )]));
  const productOptions: [string, string][] = [["", "— Χωρίς σύνδεση —"], ...products.map((p): [string, string] => [p.id, p.name])];
  const outputOptions: [string, string][] = [["", "— Χωρίς παραγόμενο απόθεμα —"], ...outputItems.map((item): [string, string] => [item.id, item.name])];

  return (
    <Page section="Συνταγολόγιο" title="Συνταγές" description="Βάσεις και γεύσεις παγωτού με τεχνική ανάλυση (PAC/POD, στερεά, σημείο πήξης) και κόστος"
      actions={can("recipes.add") ? (
        <Modal wide label={<><Plus /> Νέα συνταγή</>} size="sm" title="Νέα συνταγή">
          <form action={saveRecipe} className="grid gap-4 [&>button]:justify-self-end">
            <Field label="Όνομα" name="name" required minLength={2} maxLength={80} hint="π.χ. Βάση γάλακτος, Κακάο βαρυπέννητο" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Τύπος" name="type" options={RECIPE_TYPES.map((t): [string, string] => [t.value, t.label])} />
              <Field label="Μέγεθος δόσης (g)" name="batchGrams" required inputMode="numeric" defaultValue="5000" hint="Τυπική παραγωγή, για κοστολόγηση" />
            </div>
            <Select label="Προϊόν βιτρίνας" name="productId" options={productOptions} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Παραγόμενο είδος αποθέματος" name="outputGenericItemId" options={outputOptions} />
              <Field label="Διάρκεια ζωής (ημέρες)" name="shelfLifeDays" type="number" min={1} max={3650} step={1} />
            </div>
            <FormPending label="Δημιουργία συνταγής…" />
            <Submit pendingText="Δημιουργία…" className={btn("default")}>Δημιουργία</Submit>
          </form>
        </Modal>
      ) : null}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        <Card>
          <DataTable
            id="recipes"
            listing={{ ...list, total, placeholder: "Συνταγή ή προϊόν βιτρίνας…", filters: [
              { key: "type", label: "Τύπος", value: type, options: RECIPE_TYPES.map((t): [string, string] => [t.value, t.label]) },
              { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργές"], ["hidden", "Κρυφές"]] },
            ] }}
            empty={<><ChefHat className="mr-1 inline size-4" /> Καμία συνταγή ακόμα — ξεκίνα με «Νέα συνταγή». Τα είδη της συνταγής είναι τα <Link href="/items" className="underline">γενικά είδη</Link> με τη σύστασή τους.</>}
            columns={[
              { key: "name", label: "Συνταγή", required: true, sortable: true },
              { key: "type", label: "Τύπος", sortable: true },
              { key: "product", label: "Βιτρίνα", sortable: true },
              { key: "items", label: "Υλικά", numeric: true, sortable: true },
              { key: "cost", label: "Κόστος / kg", numeric: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={recipes.map((r) => {
              const analysis = analysisById.get(r.id)!;
              const typeLabel = RECIPE_TYPES.find((t) => t.value === r.type)?.label ?? r.type;
              return {
                id: r.id,
                cells: {
                  name: <Link href={`/recipes/${r.id}`} className="font-semibold underline-offset-2 hover:underline">{r.name}</Link>,
                  type: typeLabel,
                  product: r.product?.name ?? "—",
                  items: r._count.items,
                  cost: analysis.costPerKgHundredths > 0 ? euro(analysis.costPerKgHundredths / 100) : "—",
                  status: <StatusBadge look={r.active ? look("success", "Ενεργή") : look("neutral", "Κρυφή")} />,
                },
                details: {
                  label: r.name,
                  view: <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-xs text-muted-foreground">Τύπος</dt><dd className="font-medium">{typeLabel}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Προϊόν βιτρίνας</dt><dd className="font-medium">{r.product?.name ?? "Χωρίς σύνδεση"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Υλικά / δόση</dt><dd className="font-medium tabular-nums">{r._count.items} · {r.batchGrams.toLocaleString("el-GR")} g</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Κόστος / kg</dt><dd className="font-medium tabular-nums">{analysis.costPerKgHundredths > 0 ? euro(analysis.costPerKgHundredths / 100) : "—"}</dd></div>
                    </DetailGrid>
                    <Link href={`/recipes/${r.id}`} className={btn("outline", "sm")}><Eye /> Επεξεργασία συνταγής</Link>
                  </div>,
                },
              };
            })}
          />
        </Card>
      </div>
    </Page>
  );
}
