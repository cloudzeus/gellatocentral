// Άρθρα της βάσης γνώσεων από τη βάση. Οι πελάτες βλέπουν μόνο δημοσιευμένα και δημόσια· η υποστήριξη και τα εσωτερικά.
import { db } from "../db";
import { search } from "./kb";

const visible = (internal: boolean) => ({ status: "PUBLISHED" as const, ...(internal ? {} : { internal: false }) });

// shortcut: η αναζήτηση φορτώνει όλα τα δημοσιευμένα άρθρα (έως 1.000) και τα βαθμολογεί εδώ. Αρκεί για εκατοντάδες άρθρα·
// στο βήμα «μνήμη» αντικαθίσταται από αναζήτηση με διανύσματα στη βάση.
export async function searchArticles(query: string, opts: { internal: boolean; limit?: number }) {
  if (query.trim().length < 3) return [];
  const all = await db.kbArticle.findMany({ where: visible(opts.internal), select: { id: true, title: true, body: true, internal: true, category: true, helpfulYes: true, helpfulNo: true }, take: 1000 });
  return search(query, all, opts.limit ?? 5);
}
export const publishedArticles = () => db.kbArticle.findMany({ where: visible(false), orderBy: [{ views: "desc" }, { title: "asc" }], select: { id: true, title: true, category: true, views: true } });
export const publicArticle = (id: string) => db.kbArticle.findFirst({ where: { id, ...visible(false) } });
