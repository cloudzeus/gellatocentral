import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { CompositionForm } from "@/components/composition-form";
import { Badge, Card, Page, btn } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { compositionFromRow } from "@/lib/composition";
import { db } from "@/lib/db";
import { materialLactose, materialPac, materialPod, materialTotalSolids } from "@/lib/recipe-analysis";
import { normalizeManufacturerName } from "@/lib/manufacturer";
import { saveComposition, toggleTradeItem } from "../actions";
import { Submit } from "@/components/submit";
import { ItemForm } from "../item-form";

// Καρτέλα είδους του κεντρικού καταλόγου: στοιχεία και φωτογραφία, η τεχνική σύστασή του (% ανά 100 g)
// που κληρονομούν οι συνδρομητές με το mapping, και σύνοψη των υπολογισμένων τιμών για έλεγχο.
export default async function CatalogItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatform("settings.edit");
  const { id } = await params;
  const q = await searchParams;
  const [item, categories, brands, units] = await Promise.all([
    db.tradeItem.findFirst({
      where: { id, orgId: null },
      include: { brand: { include: { manufacturer: true } }, category: true, contentUnit: true, composition: true },
    }),
    db.tradeCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { children: { orderBy: { name: "asc" } } }, where: { parentId: null, active: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, include: { manufacturer: true } }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
  ]);
  if (!item) notFound();
  const c = item.composition;
  const summary = c ? compositionFromRow(c as unknown as Record<string, unknown>) : null;
  const categoryOptions: [string, string][] = categories.flatMap((x): [string, string][] => [[x.id, x.name], ...x.children.map((ch): [string, string] => [ch.id, `${x.name} › ${ch.name}`])]);
  const brandOptions: [string, string][] = brands.map((b): [string, string] => [b.id, `${normalizeManufacturerName(b.manufacturer.name)} · ${b.name}`]);

  return (
    <Page
      section="Common Tables"
      title={item.name}
      description={`${[item.brand ? `${normalizeManufacturerName(item.brand.manufacturer.name)} · ${item.brand.name}` : null, item.ean, c ? "Σύσταση καταχωρημένη" : "Χωρίς σύσταση"].filter(Boolean).join(" · ")}`}
      actions={
        <Link href="/platform/catalog" className={btn("outline", "sm")}>
          <ArrowLeft /> Κατάλογος
        </Link>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Αποθηκεύτηκε</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Στοιχεία είδους</h2>
              <p className="text-sm text-muted-foreground">Όνομα, EAN, brand, συσκευασία και φωτογραφία — κοινά για όλους τους συνδρομητές</p>
            </div>
            {item.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}
            <form action={toggleTradeItem.bind(null, item.id)}>
              <input type="hidden" name="returnTo" value="item" />
              <Submit className={btn("outline", "sm")}>{item.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit>
            </form>
          </div>
          <div className="px-5 py-5">
            <ItemForm item={item} categoryOptions={categoryOptions} brandOptions={brandOptions} units={units} />
          </div>
        </Card>

        {summary ? (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 text-lg"><FlaskConical className="size-4" /> Υπολογισμένες τιμές</h2>
                <p className="text-sm text-muted-foreground">Από την καταχωρημένη σύσταση, ανά 100 g — έτσι τις βλέπει η ανάλυση συνταγών</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["Ολικά στερεά", materialTotalSolids(summary), "%"],
                  ["Νερό", 100 - materialTotalSolids(summary), "%"],
                  ["Σάκχαρα", (summary.sucrosePct ?? 0) + (summary.dextrosePct ?? 0) + (summary.glucoseSyrupPct ?? 0) + (summary.invertSugarPct ?? 0) + (summary.fructosePct ?? 0), "%"],
                  ["Λακτόζη", materialLactose(summary), "%"],
                  ["PAC", materialPac(summary), ""],
                  ["POD", materialPod(summary), ""],
                ] as [string, number, string][]
              ).map(([label, v, unit]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{v.toLocaleString("el-GR", { maximumFractionDigits: 2 })}{unit}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}

        <Card id="composition" className="scroll-mt-28">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Σύσταση (% ανά 100 g)</h2>
              <p className="text-sm text-muted-foreground">
                {c ? "Οι αλλαγές φαίνονται στις συνταγές όσων το έχουν συνδέσει — το ιστορικό τους δεν αλλάζει" : "Χωρίς σύσταση το είδος δεν συμμετέχει στην ανάλυση συνταγών"}
                {c ? null : <> — όταν συμπληρωθεί, αντιγράφεται αυτόματα στους συνδρομητές με το επόμενο mapping</>}
              </p>
            </div>
            {c ? <Badge tone="success">Καταχωρημένη</Badge> : <Badge tone="warning">Εκκρεμεί</Badge>}
          </div>
          <div className="px-5 py-5">
            <CompositionForm action={saveComposition} composition={c} hidden={{ tradeItemId: item.id }} />
          </div>
        </Card>
      </div>
    </Page>
  );
}
