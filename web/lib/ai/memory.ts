// Η μνήμη του agent: κομμάτια κειμένου με διάνυσμα στη βάση (pgvector) και αναζήτηση με νόημα.
// Τι μπαίνει: δημοσιευμένα άρθρα (κοινά για όλους) και λυμένα αιτήματα (μόνο για τον ίδιο πελάτη).
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { aiConfig, embed } from "./openrouter";
import { chunk, scrub, vectorLiteral } from "./rules";

const cuid = () => `c${randomBytes(12).toString("hex")}`;

async function replace(sourceType: "article" | "ticket", sourceId: string, rows: { title: string; content: string; orgId: string | null; internal: boolean }[]) {
  await db.kbChunk.deleteMany({ where: { sourceType, sourceId } });
  if (!rows.length) return 0;
  const { vectors, model } = await embed(rows.map((r) => `${r.title}\n\n${r.content}`));
  for (const [i, r] of rows.entries())
    await db.$executeRaw`INSERT INTO "KbChunk" (id, "sourceType", "sourceId", "orgId", internal, title, content, model, embedding) VALUES (${cuid()}, ${sourceType}, ${sourceId}, ${r.orgId}, ${r.internal}, ${r.title}, ${r.content}, ${model}, ${vectorLiteral(vectors[i])}::vector)`;
  return rows.length;
}

/** Ένα άρθρο στη μνήμη όσο είναι δημοσιευμένο· αλλιώς βγαίνει. Χωρίς ρύθμιση OpenRouter δεν κάνει τίποτα. */
export async function indexArticle(id: string) {
  if (!(await aiConfig()).memory) return 0;
  const a = await db.kbArticle.findUnique({ where: { id } });
  const live = a && a.status === "PUBLISHED" ? a : null;
  return replace("article", id, live ? chunk(live.body).map((content) => ({ title: live.title, content, orgId: null, internal: live.internal })) : []);
}

/** Ένα λυμένο αίτημα στη μνήμη ΤΟΥ ΙΔΙΟΥ πελάτη: θέμα και δημόσια μηνύματα, χωρίς ονόματα και χωρίς προσωπικά στοιχεία. */
export async function indexTicket(id: string) {
  if (!(await aiConfig()).memory) return 0;
  const t = await db.ticket.findUnique({ where: { id }, include: { messages: { where: { internal: false, authorKind: { not: "system" } }, orderBy: { createdAt: "asc" } } } });
  const done = t && (t.status === "RESOLVED" || t.status === "CLOSED") ? t : null;
  const text = done ? done.messages.map((m) => `${m.authorKind === "support" ? "Υποστήριξη" : "Πελάτης"}: ${scrub(m.body)}`).join("\n\n") : "";
  return replace("ticket", id, done && text ? chunk(text, 1200).map((content) => ({ title: `Λυμένο αίτημα #${done.number}: ${done.subject}`, content, orgId: done.orgId, internal: true })) : []);
}

export async function reindexAll() {
  const [articles, tickets] = await Promise.all([
    db.kbArticle.findMany({ where: { status: "PUBLISHED" }, select: { id: true } }),
    db.ticket.findMany({ where: { status: { in: ["RESOLVED", "CLOSED"] } }, select: { id: true }, orderBy: { resolvedAt: "desc" }, take: 2000 }),
  ]);
  let n = 0;
  for (const a of articles) n += await indexArticle(a.id);
  for (const t of tickets) n += await indexTicket(t.id);
  // ό,τι έμεινε από άρθρα που αποσύρθηκαν ή αιτήματα που σβήστηκαν
  await db.$executeRaw`DELETE FROM "KbChunk" c WHERE (c."sourceType" = 'article' AND NOT EXISTS (SELECT 1 FROM "KbArticle" a WHERE a.id = c."sourceId" AND a.status = 'PUBLISHED')) OR (c."sourceType" = 'ticket' AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t.id = c."sourceId"))`;
  return n;
}

export type Memory = { id: string; sourceType: string; sourceId: string; title: string; content: string; distance: number };
/**
 * Τα πιο σχετικά κομμάτια για μια ερώτηση. Το φίλτρο πελάτη και ορατότητας εφαρμόζεται ΠΡΙΝ από την ομοιότητα:
 * κοινή γνώση (orgId κενό) και μόνο του ίδιου πελάτη· εσωτερικά μόνο όταν ρωτά υπάλληλος υποστήριξης.
 */
export async function recall(query: string, scope: { orgId: string; internal: boolean; limit?: number; excludeTicketId?: string }): Promise<Memory[]> {
  const c = await aiConfig();
  if (!c.memory || query.trim().length < 3) return [];
  const { vectors, model } = await embed([query]);
  // shortcut: ακριβής σύγκριση με όλα τα κομμάτια του μοντέλου (χωρίς ευρετήριο). Γρήγορο ως μερικές δεκάδες χιλιάδες κομμάτια·
  // πιο πάνω θέλει ευρετήριο HNSW, που απαιτεί σταθερό πλήθος διαστάσεων (άρα ένα μοντέλο embeddings).
  return db.$queryRaw<Memory[]>`
    SELECT id, "sourceType", "sourceId", title, content, (embedding <=> ${vectorLiteral(vectors[0])}::vector)::float8 AS distance
    FROM "KbChunk"
    WHERE model = ${model} AND embedding IS NOT NULL
      AND ("orgId" IS NULL OR "orgId" = ${scope.orgId})
      AND (internal = false OR ${scope.internal})
      AND NOT ("sourceType" = 'ticket' AND "sourceId" = ${scope.excludeTicketId ?? ""})
    ORDER BY embedding <=> ${vectorLiteral(vectors[0])}::vector
    LIMIT ${scope.limit ?? 6}`;
}
