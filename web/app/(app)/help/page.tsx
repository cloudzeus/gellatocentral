import { ArrowRight, BookOpen, LifeBuoy, Search } from "lucide-react";
import Link from "next/link";
import { btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { publishedArticles, searchArticles } from "@/lib/support/kb-data";
import { CATEGORIES, type Category } from "@/lib/support/rules";

// Η «Βοήθεια» του πελάτη: αναζήτηση και οδηγοί ανά θέμα. Αν δεν βρει απάντηση, στέλνει αίτημα.
export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  await currentOrg();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 140);
  const [found, all] = await Promise.all([q ? searchArticles(q, { internal: false, limit: 10 }) : [], publishedArticles()]);
  const groups = (Object.keys(CATEGORIES) as Category[]).map((c) => ({ c, items: all.filter((a) => a.category === c) })).filter((g) => g.items.length);

  return (
    <Page section="Υποστήριξη" title="Βοήθεια" description="Οδηγοί για ό,τι κάνεις στην εφαρμογή. Αν δεν βρεις απάντηση, στείλε αίτημα" actions={<Link href="/support" className={btn("outline")}><LifeBuoy /> Τα αιτήματά μου</Link>}>
      <div className="max-w-5xl space-y-4">
        <form role="search" className="flex gap-2">
          <span className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input type="search" name="q" defaultValue={q} aria-label="Αναζήτηση στη βοήθεια" placeholder="Τι θέλεις να κάνεις; π.χ. «δεν τυπώνει»" className="h-11 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-base" />
          </span>
          <button className={btn("default", "default", "h-11")}>Αναζήτηση</button>
        </form>

        {q ? (
          <Card>
            <h2 className="border-b border-border px-5 py-4 text-lg">{found.length ? `${found.length} ${found.length === 1 ? "οδηγός" : "οδηγοί"} για «${q}»` : `Δεν βρήκαμε οδηγό για «${q}»`}</h2>
            {found.length ? <ul className="divide-y divide-border">{found.map((a) => <li key={a.id}><Link href={`/help/${a.id}`} className="flex min-h-12 items-center gap-3 px-5 py-2 hover:bg-secondary"><BookOpen className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 font-medium">{a.title}</span><span className="text-xs text-muted-foreground max-sm:hidden">{CATEGORIES[a.category as Category]}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul>
              : <div className="flex flex-wrap items-center gap-3 px-5 py-5"><p className="min-w-0 flex-1 text-muted-foreground">Δοκίμασε με άλλες λέξεις, ή γράψε μας τι χρειάζεσαι και θα σε βοηθήσει άνθρωπος</p><Link href="/support" className={btn("default")}>Στείλε αίτημα</Link></div>}
          </Card>
        ) : null}

        {all.length === 0 ? <Card className="px-5 py-8 text-center text-muted-foreground">Δεν έχουν δημοσιευτεί οδηγοί ακόμα. Για ό,τι χρειαστείς, <Link href="/support" className="font-semibold text-primary underline underline-offset-2">στείλε αίτημα</Link></Card> : (
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map(({ c, items }) => (
              <Card key={c}>
                <div className="flex items-baseline gap-3 px-5 pt-4 pb-3"><h2 className="min-w-0 flex-1 text-base">{CATEGORIES[c]}</h2><span className="text-xs text-muted-foreground tabular-nums">{items.length} {items.length === 1 ? "οδηγός" : "οδηγοί"}</span></div>
                <ul>{items.slice(0, 6).map((a) => <li key={a.id} className="border-t border-border"><Link href={`/help/${a.id}`} className="flex min-h-11 items-center gap-3 px-5 py-1.5 hover:bg-secondary"><span className="min-w-0 flex-1 font-medium">{a.title}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></Link></li>)}</ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
