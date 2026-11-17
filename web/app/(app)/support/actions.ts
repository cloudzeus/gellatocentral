"use server";
// Ενέργειες αιτημάτων, κοινές για τον πελάτη και την υποστήριξη. Η πλευρά βγαίνει από τον χρήστη, όχι από τη φόρμα.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg, requirePlatform, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addMessage, canView, isSupport, openTicket, resolveTicket, SupportError } from "@/lib/support";
import { isCategory, PRIORITY, type Priority, URGENCY, type Urgency } from "@/lib/support/rules";

const pathOf = (support: boolean, id: string) => (support ? `/platform/support/${id}` : `/support/${id}`);
const fail = (to: string, e: unknown): never => redirect(`${to}?error=${encodeURIComponent(e instanceof SupportError ? e.message : typeof e === "string" ? e : "Κάτι πήγε στραβά. Δοκίμασε ξανά")}`);

export async function createTicket(form: FormData) {
  const { org, user } = await currentOrg();
  const d = z.object({ subject: z.string().trim().min(5).max(140), category: z.string(), urgency: z.string(), deviceId: z.string().max(40), body: z.string().trim().min(10).max(4000) }).safeParse(Object.fromEntries(form));
  if (!d.success || !isCategory(d.data.category) || !(d.data.urgency in URGENCY)) return fail("/support", "Γράψε θέμα (τουλάχιστον 5 χαρακτήρες) και περιγραφή (τουλάχιστον 10)");
  const ticket = await openTicket({ user, orgId: org.id, subject: d.data.subject, category: d.data.category, urgency: d.data.urgency as Urgency, deviceId: d.data.deviceId || null, body: d.data.body });
  redirect(`/support/${ticket.id}?saved=new`);
}

export async function reply(ticketId: string, form: FormData) {
  const user = await requireUser();
  const to = pathOf(isSupport(user), ticketId);
  const body = String(form.get("body") ?? "").trim().slice(0, 4000);
  if (body.length < 2) return fail(to, "Γράψε το μήνυμά σου");
  const error = await addMessage({ ticketId, user, body, internal: form.get("internal") === "on" }).then(() => null, (e) => e);
  if (error) return fail(to, error);
  revalidatePath(to);
  redirect(`${to}?saved=reply`);
}

export async function resolve(ticketId: string) {
  const user = await requireUser();
  const to = pathOf(isSupport(user), ticketId);
  const error = await resolveTicket(ticketId, user).then(() => null, (e) => e);
  if (error) return fail(to, error);
  revalidatePath(to);
  redirect(`${to}?saved=resolved`);
}

/** Βαθμολογία της λύσης, από τον πελάτη, μόνο σε λυμένο αίτημα. */
export async function rate(ticketId: string, form: FormData) {
  const user = await requireUser();
  const rating = Number(form.get("rating"));
  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || isSupport(user) || !canView(user, ticket) || !["RESOLVED", "CLOSED"].includes(ticket.status) || !Number.isInteger(rating) || rating < 1 || rating > 5) redirect("/support");
  await db.ticket.update({ where: { id: ticketId }, data: { rating } });
  revalidatePath(`/support/${ticketId}`);
  redirect(`/support/${ticketId}?saved=rated`);
}

export async function assignToMe(ticketId: string) {
  const me = await requirePlatform("support.tickets");
  await db.ticket.updateMany({ where: { id: ticketId }, data: { assigneeId: me.id, assigneeName: me.name } });
  revalidatePath(`/platform/support/${ticketId}`);
  redirect(`/platform/support/${ticketId}?saved=assigned`);
}

export async function setPriority(ticketId: string, form: FormData) {
  await requirePlatform("support.tickets");
  const priority = String(form.get("priority"));
  if (priority in PRIORITY) await db.ticket.updateMany({ where: { id: ticketId }, data: { priority: priority as Priority } });
  revalidatePath(`/platform/support/${ticketId}`);
  redirect(`/platform/support/${ticketId}?saved=priority`);
}
