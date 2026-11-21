import { GitMerge } from "lucide-react";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { mergeManufacturers } from "../actions";

// Εντοπισμός και συγχώνευση διπλότυπων κατασκευαστών. Η εισαγωγή OFF δημιουργεί παραλλαγές
// του ίδιου ονόματος («Mr . Grand», «Mr. Grand», «MrGrand») γιατί κάθε brand γίνεται και
// κατασκευαστής. Τα ονόματα ομαδοποιούνται με κανονικοποιημένο κλειδί (πεζά, χωρίς σημεία
// στίξης/κενά/σύμβολα) και ο διαχειριστής διαλέγει ποιος κρατιέται — τα brands και τα είδη
// των υπόλοιπων μετακινούνται σε αυτόν (βλ. mergeManufacturers).

type DupGroup = { key: string; ids: string[]; names: string[] };

export default async function CatalogDuplicatesPage({ searchParams }: PageProps<"/platform/catalog/duplicates">) {
  await requirePlatform("settings.edit");
  const q = await searchParams;

  const groups = await db.$queryRaw<DupGroup[]>`
    SELECT key, array_agg(id ORDER BY name) AS ids, array_agg(name ORDER BY name) AS names
    FROM (
      SELECT id, name, lower(translate(name, ' .-''!()&,™®·', '')) AS key
      FROM "Manufacturer"
    ) AS norm
    GROUP BY key
    HAVING count(*) > 1
    ORDER BY count(*) DESC, key
    LIMIT 40
  `;

  const manufacturers = await db.manufacturer.findMany({
    where: { id: { in: groups.flatMap((g) => g.ids) } },
    include: { brands: { orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } } },
  });
  const byId = new Map(manufacturers.map((m) => [m.id, m]));

  return (
    <Page section="Common Tables" title="Διπλότυποι κατασκευαστές" description="Ομάδες κατασκευαστών με το ίδιο όνομα μετά την κανονικοποίηση (πεζά, χωρίς στίξη και σύμβολα) — διάλεξε ποιος κρατιέται και οι υπόλοιποι ενώνονται σε αυτόν"
      actions={<Link href="/platform/catalog" className={btn("outline")}>← Κατάλογος</Link>}>
      <div className="grid max-w-4xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν έγινε συγχώνευση: {q.error.slice(0, 200)}</p> : null}
        {typeof q.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Συγχωνεύτηκαν {q.saved} κατασκευαστές στον κρατούμενο</p> : null}

        {groups.length ? (
          groups.map((g) => (
            <Card key={g.key}>
              <form action={mergeManufacturers} className="grid gap-3 px-5 py-4">
                {g.ids.map((id) => (
                  <input key={id} type="hidden" name="memberId" value={id} />
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.ids.map((id, i) => {
                    const m = byId.get(id);
                    if (!m) return null;
                    return (
                      <label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3.5 py-3 hover:bg-secondary/60 has-checked:border-primary/50 has-checked:bg-primary/5">
                        <input type="radio" name="keepId" value={id} defaultChecked={i === 0} required className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
                        <span className="min-w-0">
                          <span className="font-medium">{m.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {m.brands.length
                              ? m.brands.map((b) => (b._count.items ? `${b.name} (${b._count.items} είδη)` : b.name)).join(", ")
                              : "χωρίς brands"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-3">
                  <span className="text-xs text-muted-foreground">Brands και είδη των υπόλοιπων περνούν στον επιλεγμένο</span>
                  <Submit className={btn("default")}><GitMerge /> Συγχώνευση</Submit>
                </div>
              </form>
            </Card>
          ))
        ) : (
          <Card>
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Δεν βρέθηκαν διπλότυποι κατασκευαστές — ο κατάλογος είναι καθαρός</p>
          </Card>
        )}
        {groups.length === 40 ? <p className="px-1 text-xs text-muted-foreground">Εμφανίζονται οι 40 μεγαλύτερες ομάδες — μετά από κάθε συγχώνευση η σελίδα ξαναϋπολογίζει τα διπλότυπα.</p> : null}
      </div>
    </Page>
  );
}
