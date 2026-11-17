"use server";
// Ο agent στην οθόνη του αιτήματος: ο υπάλληλος ζητά προσχέδιο και αποφασίζει τι θα γίνει με αυτό.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatform } from "@/lib/auth";
import { draftFor } from "@/lib/ai/agent";
import { reindexAll } from "@/lib/ai/memory";
import { AiError } from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { addMessage } from "@/lib/support";

const page = (ticketId: string, params: Record<string, string>): never => redirect(`/platform/support/${ticketId}?${new URLSearchParams(params)}#agent`);

export async function makeDraft(ticketId: string) {
  const me = await requirePlatform("support.tickets");
  const error = await draftFor(ticketId, me.name).then(() => null, (e) => { if (!(e instanceof AiError)) console.error("agent draft", e); return e instanceof AiError ? e.message : "Το προσχέδιο δεν έγινε. Δοκίμασε ξανά"; });
  revalidatePath(`/platform/support/${ticketId}`);
  page(ticketId, error ? { error } : { saved: "draft" });
}

/** Αποστολή (όπως είναι ή αλλαγμένο) ή απόρριψη. Καταγράφεται τι έγινε, για να μετριέται πόσο βοηθά ο agent. */
export async function decideDraft(runId: string, form: FormData) {
  const me = await requirePlatform("support.tickets");
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.outcome) redirect("/platform/support");
  if (form.get("decision") === "reject") {
    await db.agentRun.update({ where: { id: runId }, data: { outcome: "rejected" } });
    return page(run.ticketId, { saved: "rejected" });
  }
  const body = String(form.get("body") ?? "").trim().slice(0, 4000);
  if (body.length < 2) return page(run.ticketId, { error: "Το προσχέδιο είναι άδειο" });
  await addMessage({ ticketId: run.ticketId, user: me, body, internal: false });
  await db.agentRun.update({ where: { id: runId }, data: { outcome: body === run.reply.trim() ? "sent" : "edited" } });
  revalidatePath(`/platform/support/${run.ticketId}`);
  page(run.ticketId, { saved: "reply" });
}

export async function refreshMemory() {
  await requirePlatform("support.kb");
  const result = await reindexAll().then((n) => ({ saved: `Η μνήμη ενημερώθηκε: ${n} κομμάτια` }), (e) => ({ error: e instanceof AiError ? e.message : "Η ενημέρωση απέτυχε. Δοκίμασε ξανά" }));
  revalidatePath("/platform/kb");
  redirect(`/platform/kb?${new URLSearchParams(result)}#agent`);
}
