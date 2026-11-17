import Link from "next/link";
import { notFound } from "next/navigation";
import { KbBody } from "@/components/kb-body";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { publicArticle } from "@/lib/support/kb-data";
import { CATEGORIES, type Category } from "@/lib/support/rules";
import { vote } from "../actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "long", timeZone: "Europe/Athens" });

export default async function ArticlePage({ params, searchParams }: PageProps<"/help/[id]">) {
  await currentOrg();
  const article = await publicArticle((await params).id);
  if (!article) notFound();
  await db.kbArticle.update({ where: { id: article.id }, data: { views: { increment: 1 } } });
  const voted = (await searchParams).voted === "yes";
  const minutes = Math.max(1, Math.round(article.body.split(/\s+/).length / 180));
  return (
    <Page section={`Βοήθεια › ${CATEGORIES[article.category as Category] ?? "Οδηγοί"}`} title={article.title} description={`Ενημερώθηκε ${day.format(article.updatedAt)} · ${minutes} ${minutes === 1 ? "λεπτό" : "λεπτά"} διάβασμα`} actions={<Link href="/help" className={btn("outline")}>Όλοι οι οδηγοί</Link>}>
      <div className="max-w-3xl space-y-4">
        <Card className="p-6"><KbBody body={article.body} /></Card>
        <Card className="flex flex-wrap items-center gap-3 px-5 py-4">
          {voted ? <p role="status" className="font-medium text-success-ink">Χαιρόμαστε που βοήθησε</p> : (
            <>
              <p className="min-w-0 flex-1 font-medium">Σε βοήθησε αυτός ο οδηγός;</p>
              <form action={vote.bind(null, article.id, true)}><Submit className={btn("outline")}>Ναι</Submit></form>
              <form action={vote.bind(null, article.id, false)}><Submit className={btn("outline")}>Όχι, θέλω βοήθεια</Submit></form>
            </>
          )}
        </Card>
      </div>
    </Page>
  );
}
