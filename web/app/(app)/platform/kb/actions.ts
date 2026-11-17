"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCategory } from "@/lib/support/rules";

const to = (id: string, params: Record<string, string>): never => redirect(`/platform/kb/${id}?${new URLSearchParams(params)}`);

export async function createArticle(form: FormData) {
  const me = await requirePlatform("support.tickets");
  const title = String(form.get("title") ?? "").trim().slice(0, 160);
  const category = String(form.get("category"));
  if (title.length < 5 || !isCategory(category)) redirect(`/platform/kb?error=${encodeURIComponent("Γράψε τίτλο με τουλάχιστον 5 χαρακτήρες")}`);
  const article = await db.kbArticle.create({ data: { title, category, internal: form.get("internal") === "on", body: "", authorName: me.name } });
  redirect(`/platform/kb/${article.id}`);
}

/** Πρόχειρο άρθρο από ένα αίτημα: θέμα και οι απαντήσεις της υποστήριξης (όχι τα μηνύματα του πελάτη). */
export async function articleFromTicket(ticketId: string) {
  const me = await requirePlatform("support.tickets");
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { messages: { where: { authorKind: "support", internal: false }, orderBy: { createdAt: "asc" } } } });
  if (!ticket) redirect("/platform/support");
  const existing = await db.kbArticle.findFirst({ where: { sourceTicketId: ticket.id } });
  if (existing) redirect(`/platform/kb/${existing.id}`);
  const body = ["## Τι συμβαίνει", "Περιέγραψε το πρόβλημα όπως το βλέπει ο πελάτης, χωρίς ονόματα και στοιχεία του.", "## Πώς λύνεται", ...ticket.messages.map((m) => m.body)].join("\n\n");
  const article = await db.kbArticle.create({ data: { title: ticket.subject, category: ticket.category, body, sourceTicketId: ticket.id, authorName: me.name } });
  redirect(`/platform/kb/${article.id}?saved=fromticket`);
}

export async function saveArticle(id: string, form: FormData) {
  const me = await requirePlatform("support.tickets");
  const d = z.object({ title: z.string().trim().min(5).max(160), category: z.string(), body: z.string().trim().min(20).max(20000) }).safeParse(Object.fromEntries(form));
  if (!d.success || !isCategory(d.data.category)) return to(id, { error: "Ο τίτλος θέλει τουλάχιστον 5 χαρακτήρες και το κείμενο τουλάχιστον 20" });
  const article = await db.kbArticle.findUnique({ where: { id } });
  if (!article) redirect("/platform/kb");
  const changed = article.title !== d.data.title || article.body !== d.data.body;
  // αλλαγή σε δημοσιευμένο άρθρο από κάποιον που δεν εγκρίνει: γυρίζει «προς έγκριση» και δεν φαίνεται στους πελάτες μέχρι να εγκριθεί
  const demote = article.status === "PUBLISHED" && changed && !me.can("support.kb");
  await db.$transaction([
    ...(changed && article.body ? [db.kbVersion.create({ data: { articleId: id, title: article.title, body: article.body, savedByName: article.updatedByName ?? article.authorName } })] : []),
    db.kbArticle.update({ where: { id }, data: { title: d.data.title, category: d.data.category, body: d.data.body, internal: form.get("internal") === "on", updatedByName: me.name, ...(demote ? { status: "REVIEW" } : {}) } }),
  ]);
  revalidatePath(`/platform/kb/${id}`);
  to(id, { saved: demote ? "review" : "1" });
}

const MOVES = { REVIEW: ["DRAFT"], PUBLISHED: ["DRAFT", "REVIEW", "RETIRED"], RETIRED: ["PUBLISHED"], DRAFT: ["REVIEW", "RETIRED"] } as const;
/** Αλλαγή κατάστασης. Δημοσίευση και απόσυρση μόνο από όποιον έχει το δικαίωμα έγκρισης. */
export async function setArticleStatus(id: string, next: keyof typeof MOVES) {
  const me = await requirePlatform("support.tickets");
  const article = await db.kbArticle.findUnique({ where: { id } });
  if (!article || !(MOVES[next] as readonly string[]).includes(article.status)) return to(id, { error: "Η αλλαγή κατάστασης δεν επιτρέπεται από εδώ" });
  if ((next === "PUBLISHED" || next === "RETIRED" || article.status === "PUBLISHED") && !me.can("support.kb")) return to(id, { error: "Η δημοσίευση και η απόσυρση θέλουν δικαίωμα έγκρισης άρθρων" });
  if (next !== "DRAFT" && article.body.trim().length < 20) return to(id, { error: "Γράψε και αποθήκευσε πρώτα το κείμενο του άρθρου" });
  await db.kbArticle.update({ where: { id }, data: { status: next, ...(next === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
  revalidatePath("/platform/kb");
  to(id, { saved: next.toLowerCase() });
}
