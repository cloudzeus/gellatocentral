import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy, FlaskConical } from "lucide-react";
import { CompositionForm } from "@/components/composition-form";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { compositionFromRow } from "@/lib/composition";
import { db } from "@/lib/db";
import { materialLactose, materialPac, materialPod, materialTotalSolids } from "@/lib/recipe-analysis";
import { copyComposition, saveItemComposition } from "../../actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

// Σύσταση γενικού είδους (% ανά 100 g): την κληρονομεί από τον κεντρικό κατάλογο με το mapping
// και μπορεί να προσαρμοστεί ανά επιχείρηση (π.χ. ιδιωτική παραγωγή, διαφορετικός προμηθευτής).
export default async function ItemCompositionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, can } = await currentOrg("items.read");
  const { id } = await params;
  const q = await searchParams;
  const generic = await db.genericItem.findFirst({
    where: { id, orgId: org.id },
    include: {
      composition: true,
      mappings: { orderBy: { createdAt: "asc" }, include: { tradeItem: { include: { composition: { select: { id: true } } } } } },
    },
  });
  if (!generic) notFound();
  const c = generic.composition;
  const canCopy = generic.mappings.some((m) => m.tradeItem.composition);
  const summary = c ? compositionFromRow(c as unknown as Record<string, unknown>) : null;

  return (
    <Page
      section="Συνταγολόγιο"
      title={`Σύσταση: ${generic.name}`}
      description="Τεχνικά χαρακτηριστικά ανά 100 g — τροφοδοτούν την ανάλυση συνταγών (PAC/POD, στερεά, κόστος)"
      actions={
        <Link href={`/items/${generic.id}`} className={btn("outline", "sm")}>
          <ArrowLeft /> {generic.name}
        </Link>
      }
    >
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}

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
                {c ? "Δική σου σύσταση — δεν επηρεάζεται από αλλαγές του κεντρικού καταλόγου" : canCopy ? "Μπορείς να την αντιγράψεις από τον κεντρικό κατάλογο ή να τη συμπληρώσεις" : "Σύνδεσε συσκευασία του καταλόγου για αυτόματη αντιγραφή ή συμπλήρωσέ τη χειροκίνητα"}
              </p>
            </div>
            <StatusBadge look={c ? look("success", "Καταχωρημένη") : look("warning", "Εκκρεμεί")} />
            {can("items.edit") && canCopy ? (
              <form action={copyComposition.bind(null, generic.id)}>
                <Submit className={btn("outline", "sm")}><Copy /> {c ? "Επαναφορά από κατάλογο" : "Αντιγραφή από κατάλογο"}</Submit>
              </form>
            ) : null}
          </div>
          <div className="px-5 py-5">
            <CompositionForm action={saveItemComposition} composition={c} hidden={{ genericItemId: generic.id }} />
          </div>
        </Card>
      </div>
    </Page>
  );
}
