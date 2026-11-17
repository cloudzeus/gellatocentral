import Link from "next/link";
import { notFound } from "next/navigation";
import { KbBody } from "@/components/kb-body";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { helpful, KB_STATUS } from "@/lib/support/kb";
import { CATEGORIES } from "@/lib/support/rules";
import { saveArticle, setArticleStatus } from "../actions";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { "1": "Αποθηκεύτηκε", review: "Αποθηκεύτηκε και περιμένει ξανά έγκριση: μέχρι τότε οι πελάτες δεν το βλέπουν", fromticket: "Πρόχειρο από το αίτημα. Σβήσε ό,τι αφορά τον συγκεκριμένο πελάτη πριν το στείλεις για έγκριση", draft: "Γύρισε σε πρόχειρο", published: "Δημοσιεύτηκε", retired: "Αποσύρθηκε" };

export default async function ArticleEditPage({ params, searchParams }: PageProps<"/platform/kb/[id]">) {
  const me = await requirePlatform("support.tickets");
  const article = await db.kbArticle.findUnique({ where: { id: (await params).id }, include: { versions: { orderBy: { createdAt: "desc" }, take: 5 } } });
  if (!article) notFound();
  const q = await searchParams;
  const canPublish = me.can("support.kb");
  const h = helpful(article.helpfulYes, article.helpfulNo);
  const act = (next: Parameters<typeof setArticleStatus>[1], label: string, variant: "default" | "outline" = "outline") => <form action={setArticleStatus.bind(null, article.id, next)}><Submit className={btn(variant)}>{label}</Submit></form>;

  return (
    <Page section="Υποστήριξη πελατών › Βάση γνώσεων" title={article.title} description={`${article.internal ? "Εσωτερικό" : "Για τους πελάτες"} · το έγραψε ο χρήστης ${article.authorName}${article.sourceTicketId ? " · από αίτημα" : ""}`}
      actions={<>
        <Badge tone={KB_STATUS[article.status].tone}>{KB_STATUS[article.status].text}</Badge>
        {article.status === "DRAFT" ? act("REVIEW", "Αποστολή για έγκριση", canPublish ? "outline" : "default") : null}
        {canPublish && (article.status === "DRAFT" || article.status === "REVIEW") ? act("PUBLISHED", "Δημοσίευση", "default") : null}
        {article.status === "REVIEW" ? act("DRAFT", "Πίσω σε πρόχειρο") : null}
        {canPublish && article.status === "PUBLISHED" ? act("RETIRED", "Απόσυρση") : null}
        {canPublish && article.status === "RETIRED" ? act("DRAFT", "Επαναφορά σε πρόχειρο") : null}
        <Link href="/platform/kb" className={btn("outline")}>Όλα τα άρθρα</Link>
      </>}>
      <div className="grid max-w-7xl gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
          {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 200)}</p> : null}
          <Card className="p-5">
            <form key={article.updatedAt.toISOString()} action={saveArticle.bind(null, article.id)} className="grid gap-4 [&>button]:justify-self-end">
              <Field label="Τίτλος" name="title" required minLength={5} maxLength={160} defaultValue={article.title} />
              <Select label="Θέμα" name="category" defaultValue={article.category} options={Object.entries(CATEGORIES)} />
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="internal" defaultChecked={article.internal} className="size-4 accent-[var(--primary)]" /> Εσωτερικό: το βλέπει μόνο η υποστήριξη</label>
              <label className="block space-y-1 text-sm font-medium">Κείμενο<span className="text-destructive"> *</span>
                <textarea name="body" required minLength={20} maxLength={20000} rows={18} defaultValue={article.body} className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm font-normal leading-relaxed" />
                <span className="block text-xs font-normal text-muted-foreground">Κενή γραμμή = νέα παράγραφος · «## » υπότιτλος · «- » λίστα · «1. » βήματα. Γράψε απλά, σε δεύτερο πρόσωπο, πρώτα το τι κάνει ο χρήστης</span>
              </label>
              <Submit className={btn("default")}>Αποθήκευση</Submit>
            </form>
          </Card>
          {article.versions.length ? (
            <Card>
              <h2 className="px-5 pt-4 pb-3 text-base">Προηγούμενες εκδόσεις</h2>
              <ul>{article.versions.map((v) => <li key={v.id} className="border-t border-border px-5 py-2.5"><details><summary className="cursor-pointer font-medium">{when.format(v.createdAt)} · {v.savedByName}</summary><p className="mt-2 font-semibold">{v.title}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{v.body}</p></details></li>)}</ul>
            </Card>
          ) : null}
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex items-baseline gap-3 border-b border-border px-5 py-3"><h2 className="min-w-0 flex-1 text-base">Όπως θα το δει ο αναγνώστης</h2><span className="text-xs text-muted-foreground">αποθηκευμένη μορφή</span></div>
            <div className="p-6">{article.body.trim() ? <><h3 className="mb-3 text-xl font-semibold">{article.title}</h3><KbBody body={article.body} /></> : <p className="text-muted-foreground">Το άρθρο δεν έχει κείμενο ακόμα</p>}</div>
          </Card>
          <Card>
            <dl className="grid grid-cols-3 gap-4 px-5 py-4">
              <div><dt className="text-xs font-medium text-muted-foreground">Προβολές</dt><dd className="text-xl font-semibold tabular-nums">{article.views}</dd></div>
              <div><dt className="text-xs font-medium text-muted-foreground">«Σε βοήθησε;»</dt><dd className="text-xl font-semibold tabular-nums">{article.helpfulYes} ναι · {article.helpfulNo} όχι</dd></div>
              <div><dt className="text-xs font-medium text-muted-foreground">Χρησιμότητα</dt><dd className="text-xl font-semibold tabular-nums">{h === null ? "—" : `${h}%`}</dd></div>
            </dl>
            {article.sourceTicketId ? <p className="border-t border-border px-5 py-3"><Link href={`/platform/support/${article.sourceTicketId}`} className="font-semibold text-primary hover:underline">Το αίτημα από το οποίο προέκυψε</Link></p> : null}
          </Card>
        </div>
      </div>
    </Page>
  );
}
