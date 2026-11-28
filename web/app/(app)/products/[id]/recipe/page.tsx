import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Coins, Pencil, Percent, Receipt } from "lucide-react";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Kpi, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { MODIFIER_KIND_LABEL } from "@/lib/product-catalog";
import { DIMENSION_UNIT, formatRecipeQty, lineCost, recipeQtyInput, salesRecipePage, typicalCost } from "@/lib/sales-recipes";
import { saveRecipeLines } from "./actions";

type Generic = { id: string; name: string; avgCostHundredths: number; consumptionSource: string; dimension: string };
type Line = { id: string; genericItemId: string; quantityBase: number };

const SOURCE = {
  SALE: { tone: "success", label: "Με την πώληση" },
  COUNT: { tone: "neutral", label: "Από την απογραφή" },
} as const;
const sourceOf = (g?: Generic) => SOURCE[g?.consumptionSource === "COUNT" ? "COUNT" : "SALE"];
// Χρώματα της μπάρας κόστους: το μεγαλύτερο κομμάτι στο κύριο χρώμα, τα υπόλοιπα σε ήπιους τόνους.
const BAR = ["var(--primary)", "var(--gold, var(--accent))", "color-mix(in oklab, var(--primary) 45%, transparent)", "color-mix(in oklab, var(--primary) 25%, transparent)", "color-mix(in oklab, var(--primary) 12%, transparent)"];

// Καρτέλα «Συνταγή πώλησης» προϊόντος: βασικά υλικά, υλικά ανά επιλογή του ταμείου, κόστος και περιθώριο.
export default async function SalesRecipePage({ params, searchParams }: PageProps<"/products/[id]/recipe">) {
  const { org, can } = await currentOrg("products.read");
  const { id } = await params;
  const q = await searchParams;
  const data = await salesRecipePage(db, org.id, id);
  if (!data) notFound();
  const { product, productRecipe, optionRecipes, generics } = data;
  const byId = new Map(generics.map((g) => [g.id, g]));
  const costOf = (lines: readonly Line[]) => lines.reduce((sum, l) => { const g = byId.get(l.genericItemId); return sum + (g ? lineCost(l.quantityBase, g.avgCostHundredths, g.dimension) : 0); }, 0);
  const baseLines = productRecipe?.lines ?? [];
  const baseCost = costOf(baseLines);
  const groups = product.modifierGroups.map((link) => ({
    ...link.group,
    pick: link.pick,
    options: link.group.options.map((o) => { const r = optionRecipes.get(o.id); return { ...o, lines: r?.lines ?? null, cost: r ? costOf(r.lines) : null }; }),
  }));
  const typical = typicalCost(baseCost, groups.map((g) => ({ kind: g.kind, pick: g.pick, optionCosts: g.options.map((o) => o.cost) })));
  const netPrice = product.priceCents / (1 + product.vatRate.rate / 100);
  const margin = netPrice > 0 ? Math.round((netPrice - typical.cents) / netPrice * 100) : null;
  const hasRecipe = !!productRecipe || groups.some((g) => g.options.some((o) => o.lines));
  const marginTone = margin === null || !hasRecipe ? "neutral" : margin >= 65 ? "success" : margin >= 50 ? "warning" : "danger";

  // Μπάρα κόστους: κάθε βασικό υλικό χωριστά, οι υποχρεωτικές επιλογές ως ένα κομμάτι (μέσος όρος).
  const optionPart = typical.cents - baseCost;
  const parts = [
    ...baseLines.map((l) => { const g = byId.get(l.genericItemId); return { label: g?.name ?? "—", cents: g ? lineCost(l.quantityBase, g.avgCostHundredths, g.dimension) : 0 }; }),
    ...(optionPart > 0.5 ? [{ label: groups.filter((g) => g.kind === "REQUIRED").map((g) => g.name).join(", ") || "Επιλογές", cents: optionPart }] : []),
  ].filter((p) => p.cents > 0).sort((a, b) => b.cents - a.cents);
  const partsTotal = parts.reduce((s, p) => s + p.cents, 0);

  const linesForm = (lines: readonly Line[] | null, optionId: string | null, allowNegative: boolean) => {
    const rows = [...(lines ?? []).map((l) => ({ g: l.genericItemId, q: recipeQtyInput(l.quantityBase, byId.get(l.genericItemId)?.dimension ?? "mass") })), ...Array.from({ length: 3 }, () => ({ g: "", q: "" }))];
    return (
      <form action={saveRecipeLines.bind(null, product.id, optionId)} className="grid gap-3 [&>button]:justify-self-end">
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 text-xs font-medium text-muted-foreground"><span>Υλικό</span><span>Ποσότητα</span></div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <select name="g" defaultValue={row.g} aria-label={`Υλικό ${i + 1}`} className="h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11">
                <option value="">— κενή γραμμή —</option>
                {generics.map((g) => <option key={g.id} value={g.id}>{g.name} ({DIMENSION_UNIT[g.dimension]})</option>)}
              </select>
              <input name="q" defaultValue={row.q} inputMode="decimal" placeholder="π.χ. 70" aria-label={`Ποσότητα ${i + 1}`} className="h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-right text-sm tabular-nums pointer-coarse:h-11" />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Ποσότητα ανά τεμάχιο, στη μονάδα που φαίνεται δίπλα στο υλικό (g, ml ή τμχ). Για να βγάλεις υλικό, διάλεξε «κενή γραμμή».{allowNegative ? " Αρνητική ποσότητα = λιγότερο από το βασικό (π.χ. «χωρίς σιρόπι» −15)." : ""} Η αλλαγή ισχύει από τώρα· οι παλιές πωλήσεις κρατούν την έκδοση της στιγμής τους.</p>
        <FormPending label="Αποθήκευση συνταγής…" />
        <Submit pendingText="Αποθήκευση…" className={btn("default")}>Αποθήκευση</Submit>
      </form>
    );
  };

  const lineList = (lines: readonly Line[]) => (
    <ul className="divide-y divide-border/70">
      {lines.map((l) => {
        const g = byId.get(l.genericItemId);
        const s = sourceOf(g);
        return (
          <li key={l.id} className="flex items-center gap-x-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"><span className="font-medium">{g?.name ?? "Άγνωστο είδος"}</span><Badge tone={s.tone}>{s.label}</Badge></span>
            <span className="w-16 text-right tabular-nums">{formatRecipeQty(l.quantityBase, g?.dimension ?? "mass")}</span>
            <span className="w-16 text-right tabular-nums text-muted-foreground">{g ? euro(Math.round(lineCost(l.quantityBase, g.avgCostHundredths, g.dimension))) : "—"}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Page section={`Προϊόντα · ${product.category.name}`} title={product.name} description="Τι φεύγει από την αποθήκη για κάθε τεμάχιο που πουλάμε, και πόσο μας κοστίζει"
      actions={<Link href="/products" className={btn("outline", "sm")}><ArrowLeft /> Προϊόντα</Link>}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi icon={Coins} label="Κόστος ανά τεμάχιο" value={hasRecipe ? euro(typical.cents) : "—"} hint={hasRecipe ? (typical.missingOptions ? `${typical.missingOptions} επιλογές χωρίς συνταγή δεν μετράνε` : "με τη μέση τιμή των γεύσεων") : "Πρόσθεσε υλικά για να βγει κόστος"} tone={typical.missingOptions ? "warning" : "neutral"} />
          <Kpi icon={Receipt} label="Τιμή πώλησης" value={euro(product.priceCents)} hint={`με ΦΠΑ ${product.vatRate.rate}% · χωρίς ΦΠΑ ${euro(Math.round(netPrice))}`} />
          <Kpi icon={Percent} label="Μικτό περιθώριο" value={hasRecipe && margin !== null ? `${margin}%` : "—"} tone={marginTone} hint={!hasRecipe ? "Χωρίς συνταγή η πώληση μπαίνει στα «Προϊόντα χωρίς συνταγή»" : marginTone === "success" ? "Καλό · στόχος πάνω από 65%" : marginTone === "warning" ? "Χαμηλό · δες τιμή ή μερίδα" : "Πολύ χαμηλό · η τιμή μόλις καλύπτει τα υλικά"} />
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <Card className="p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="text-sm font-semibold">Βασικά υλικά</h2><p className="text-xs text-muted-foreground">Μπαίνουν σε κάθε τεμάχιο, ό,τι κι αν διαλέξει ο πελάτης{productRecipe ? ` · έκδοση ${productRecipe.version}` : ""}</p></div>
                {can("products.edit") ? <Modal wide label={<><Pencil /> Επεξεργασία</>} size="sm" title={`Βασικά υλικά: ${product.name}`}>{linesForm(baseLines, null, false)}</Modal> : null}
              </div>
              {baseLines.length ? lineList(baseLines) : <p className="rounded-lg bg-secondary px-4 py-3 text-muted-foreground">Κανένα βασικό υλικό ακόμα. Π.χ. κύπελλο και κουτάλι, 1 τμχ το καθένα</p>}
            </Card>

            {groups.map((g) => (
              <Card key={g.id} className="p-5">
                <div className="mb-2"><h2 className="text-sm font-semibold">{g.name}</h2><p className="text-xs text-muted-foreground">{MODIFIER_KIND_LABEL[g.kind as keyof typeof MODIFIER_KIND_LABEL]}{g.kind === "REQUIRED" ? ` · ο πελάτης διαλέγει ${g.pick}` : ""}. Κάθε επιλογή έχει τα δικά της υλικά</p></div>
                <ul className="divide-y divide-border/70">
                  {g.options.map((o) => (
                    <li key={o.id} className="grid gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 font-semibold">{o.name}</span>
                        {o.lines ? <span className="tabular-nums text-muted-foreground">{euro(Math.round(o.cost ?? 0))}</span> : <Badge tone="warning">Χωρίς συνταγή</Badge>}
                        {can("products.edit") ? <Modal wide label={<><Pencil /> Υλικά</>} size="sm" title={`${g.name}: ${o.name}`}>{linesForm(o.lines, o.id, true)}</Modal> : null}
                      </div>
                      {o.lines?.length ? <p className="text-xs text-muted-foreground">{o.lines.map((l) => { const gi = byId.get(l.genericItemId); return `${gi?.name ?? "—"} ${formatRecipeQty(l.quantityBase, gi?.dimension ?? "mass")}`; }).join(" · ")}</p> : o.lines ? <p className="text-xs text-muted-foreground">Δεν καταναλώνει υλικά</p> : null}
                    </li>
                  ))}
                  {!g.options.length ? <li className="py-3 text-muted-foreground">Η ομάδα δεν έχει ενεργές επιλογές</li> : null}
                </ul>
              </Card>
            ))}
          </div>

          <div className="grid gap-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Πού πάει το κόστος</h2>
              {partsTotal > 0 ? (
                <>
                  <div className="mt-3 mb-2 flex h-7 overflow-hidden rounded-md" role="img" aria-label={parts.map((p) => `${p.label} ${euro(Math.round(p.cents))}`).join(", ")}>
                    {parts.map((p, i) => <span key={p.label} style={{ width: `${(p.cents / partsTotal) * 100}%`, background: BAR[Math.min(i, BAR.length - 1)] }} />)}
                  </div>
                  <ul className="grid gap-1 text-xs">
                    {parts.map((p, i) => (
                      <li key={p.label} className="flex items-center gap-2"><span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: BAR[Math.min(i, BAR.length - 1)] }} /><span className="min-w-0 flex-1 truncate">{p.label}</span><span className="tabular-nums">{euro(Math.round(p.cents))} · {Math.round((p.cents / partsTotal) * 100)}%</span></li>
                    ))}
                  </ul>
                </>
              ) : <p className="mt-2 text-muted-foreground">Θα φανεί μόλις μπουν υλικά με κόστος</p>}
            </Card>
            <Card className="grid gap-2 p-5">
              <h2 className="text-sm font-semibold">Τι σημαίνει «Πώς μετράει»</h2>
              <p><Badge tone="success">Με την πώληση</Badge> Βγαίνει από την αποθήκη τη στιγμή που χτυπάει το ταμείο.</p>
              <p><Badge>Από την απογραφή</Badge> Τα παγωτά της βιτρίνας μετριούνται το βράδυ. Από τις πωλήσεις βλέπουμε μόνο πόσο θα έπρεπε να φύγει, για να συγκρίνουμε.</p>
              <p className="text-xs text-muted-foreground">Ορίζεται στην καρτέλα του είδους. Το κόστος έρχεται από τη μέση τιμή αγοράς του είδους.</p>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
