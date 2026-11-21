import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { CompositionForm } from "@/components/composition-form";
import { Badge, Card, Page, btn } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { compositionFromRow } from "@/lib/composition";
import { db } from "@/lib/db";
import { materialLactose, materialPac, materialPod, materialTotalSolids } from "@/lib/recipe-analysis";
import { saveComposition } from "../actions";

// Καρτέλα είδους του κεντρικού καταλόγου: η τεχνική σύστασή του (% ανά 100 g) που κληρονομούν
// οι συνδρομητές με το mapping, και σύνοψη των υπολογισμένων τιμών για έλεγχο πριν την αποθήκευση.
export default async function CatalogItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatform("settings.edit");
  const { id } = await params;
  const q = await searchParams;
  const item = await db.tradeItem.findFirst({
    where: { id, orgId: null },
    include: { brand: { include: { manufacturer: true } }, category: true, contentUnit: true, composition: true },
  });
  if (!item) notFound();
  const c = item.composition;
  const summary = c ? compositionFromRow(c as unknown as Record<string, unknown>) : null;

  return (
    <Page
      section="Common Tables"
      title={item.name}
      description={`${[item.brand ? `${item.brand.manufacturer.name} · ${item.brand.name}` : null, item.ean, c ? "Σύσταση καταχωρημένη" : "Χωρίς σύσταση"].filter(Boolean).join(" · ")}`}
      actions={
        <Link href="/platform/catalog" className={btn("outline", "sm")}>
          <ArrowLeft /> Κατάλογος
        </Link>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η σύσταση αποθηκεύτηκε</p> : null}

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

        <Card>
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
