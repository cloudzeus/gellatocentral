import { GitMerge, Sparkles } from "lucide-react";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { findManufacturerDuplicates, normalizeManufacturerName } from "@/lib/manufacturer";
import { mergeManufacturers } from "../actions";

// Κανονικοποίηση ονομάτων και AI προτάσεις είναι δύο διακριτές ενδείξεις. Και στις δύο
// ο διαχειριστής βλέπει τα brands και διαλέγει ποιος κρατιέται· δεν γίνεται αυτόματη συγχώνευση.
export default async function CatalogDuplicatesPage({ searchParams }: PageProps<"/platform/catalog/duplicates">) {
  await requirePlatform("settings.edit");
  const q = await searchParams;
  const all = await db.manufacturer.findMany({ select: { id: true, name: true } });
  const groups = findManufacturerDuplicates(all).slice(0, 40);
  const [manufacturers, rawSuggestions, suggestionsTotal] = await Promise.all([
    db.manufacturer.findMany({ where: { id: { in: groups.flatMap((g) => g.ids) } }, include: { brands: { orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } } } }),
    db.manufacturerMergeSuggestion.findMany({ orderBy: [{ confidence: "desc" }, { createdAt: "desc" }], take: 40, include: { source: { include: { brands: { include: { _count: { select: { items: true } } } } } }, target: { include: { brands: { include: { _count: { select: { items: true } } } } } } } }),
    db.manufacturerMergeSuggestion.count(),
  ]);
  const byId = new Map(manufacturers.map((m) => [m.id, m]));
  const seenPairs = new Set<string>();
  const suggestions = rawSuggestions.filter((suggestion) => {
    const key = [suggestion.sourceId, suggestion.targetId].sort().join(":");
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  const brandsText = (brands: { name: string; _count: { items: number } }[]) => brands.length ? brands.map((b) => (b._count.items ? `${b.name} (${b._count.items} είδη)` : b.name)).join(", ") : "χωρίς brands";

  return (
    <Page section="Common Tables" title="Διπλότυποι κατασκευαστές" description="Κανόνες ονομάτων και ξεχωριστές AI προτάσεις — κάθε ενοποίηση γίνεται μόνο μετά από δική σου επιλογή"
      actions={<Link href="/platform/catalog?tab=manufacturers" className={btn("outline")}>← Κατάλογος</Link>}>
      <div className="grid max-w-5xl gap-5">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε συγχώνευση: {q.error.slice(0, 200)}</p> : null}

        <section className="grid gap-3">
          <div><h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4" /> Προτάσεις AI</h2><p className="text-sm text-muted-foreground">Υψηλή βεβαιότητα και κοινή ταυτότητα ή επαληθευμένο domain. Η πρόταση δεν αλλάζει δεδομένα χωρίς το κουμπί συγχώνευσης.</p></div>
          {suggestions.length ? suggestions.map((suggestion) => {
            const pair = [suggestion.target, suggestion.source];
            return (
              <Card key={`${suggestion.sourceId}-${suggestion.targetId}`} className="border-primary/25">
                <form action={mergeManufacturers} className="grid gap-3 px-5 py-4">
                  {pair.map((m) => <input key={m.id} type="hidden" name="memberId" value={m.id} />)}
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="warning">AI {suggestion.confidence}%</Badge><span className="text-sm text-muted-foreground">{suggestion.reason}</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pair.map((m, index) => (
                      <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3.5 py-3 hover:bg-secondary/60 has-checked:border-primary/50 has-checked:bg-primary/5">
                        <input type="radio" name="keepId" value={m.id} defaultChecked={index === 0} required className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
                        <span className="min-w-0"><span className="font-medium">{normalizeManufacturerName(m.name)}</span>{m.website ? <span className="block truncate text-xs text-muted-foreground">{m.website}</span> : null}<span className="block text-xs text-muted-foreground">{brandsText(m.brands)}</span></span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/70 pt-3"><span className="text-xs text-muted-foreground">Ενοποιούνται brands, είδη, website/logo, aliases και πρώτες ύλες</span><Submit className={btn("default")}><GitMerge /> Συγχώνευση μετά από έλεγχο</Submit></div>
                </form>
              </Card>
            );
          }) : <Card><p className="px-5 py-6 text-sm text-muted-foreground">Δεν υπάρχουν ανοικτές AI προτάσεις. Ξεκίνα εμπλουτισμό από έναν ή έως τρεις κατασκευαστές στον κατάλογο.</p></Card>}
          {suggestionsTotal > rawSuggestions.length ? <p className="px-1 text-xs text-muted-foreground">Εμφανίζονται οι {rawSuggestions.length} προτάσεις με τη μεγαλύτερη βεβαιότητα από {suggestionsTotal}</p> : null}
        </section>

        <section className="grid gap-3">
          <div><h2 className="text-base font-semibold">Ομάδες από κανόνες ονομάτων</h2><p className="text-sm text-muted-foreground">Διαφορές σε τόνους, κενά, σύμβολα ή ελληνική/λατινική γραφή.</p></div>
          {groups.length ? groups.map((g) => (
            <Card key={g.ids.join("-")}>
              <form action={mergeManufacturers} className="grid gap-3 px-5 py-4">
                {g.ids.map((id) => <input key={id} type="hidden" name="memberId" value={id} />)}
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.ids.map((id, i) => {
                    const m = byId.get(id);
                    if (!m) return null;
                    return (
                      <label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3.5 py-3 hover:bg-secondary/60 has-checked:border-primary/50 has-checked:bg-primary/5">
                        <input type="radio" name="keepId" value={id} defaultChecked={i === 0} required className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
                        <span className="min-w-0"><span className="font-medium">{normalizeManufacturerName(m.name)}</span><span className="block text-xs text-muted-foreground">{brandsText(m.brands)}</span></span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/70 pt-3"><span className="text-xs text-muted-foreground">Brands και είδη των υπόλοιπων περνούν στον επιλεγμένο</span><Submit className={btn("default")}><GitMerge /> Συγχώνευση</Submit></div>
              </form>
            </Card>
          )) : <Card><p className="px-5 py-8 text-center text-sm text-muted-foreground">Δεν βρέθηκαν διπλότυπα από τους κανόνες ονομάτων</p></Card>}
          {groups.length === 40 ? <p className="px-1 text-xs text-muted-foreground">Εμφανίζονται οι 40 μεγαλύτερες ομάδες — μετά από κάθε συγχώνευση η σελίδα ξαναϋπολογίζει τα διπλότυπα.</p> : null}
        </section>
      </div>
    </Page>
  );
}
