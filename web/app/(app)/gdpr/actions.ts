"use server";
// Ενέργειες GDPR, κοινές για την κονσόλα της πλατφόρμας (scope "platform") και για κάθε πελάτη (scope = η επιχείρησή του).
// Κάθε ενέργεια ελέγχει ξανά στον server ότι ο χρήστης διαχειρίζεται το συγκεκριμένο επίπεδο.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageGdpr, completeErasure, GdprError, recordConsent, rejectErasure, requestErasure, scopeOf } from "@/lib/gdpr";
import { isPurpose, PURPOSES } from "@/lib/gdpr/rules";

const base = (scope: string | null) => (scope === null ? "/platform/gdpr" : "/gdpr");
const back = (scope: string | null, params: Record<string, string>): never => redirect(`${base(scope)}?${new URLSearchParams(params)}`);
const say = (e: unknown) => (e instanceof GdprError ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά");

/** Ο χρήστης και το επίπεδο που διαχειρίζεται. `key`: "platform" ή το id της επιχείρησης. */
async function manager(key: string) {
  const user = await requireUser();
  const scope = key === "platform" ? null : key;
  if (!canManageGdpr(user, scope)) redirect("/");
  return { user, scope, actor: { id: user.id, name: user.name } };
}
/** Το αίτημα, μόνο αν ανήκει σε επίπεδο που διαχειρίζεται ο χρήστης. */
async function owned(id: string) {
  const user = await requireUser();
  const req = await db.erasureRequest.findUnique({ where: { id } });
  if (!req || !canManageGdpr(user, req.orgId)) redirect("/");
  return { req, scope: req.orgId, actor: { id: user.id, name: user.name } };
}

/** Καταχώριση αιτήματος που ήρθε εκτός εφαρμογής (email, τηλέφωνο, έγγραφο). */
export async function openRequest(key: string, form: FormData) {
  const { scope, actor } = await manager(key);
  const d = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().max(160), reason: z.string().trim().max(500) }).safeParse(Object.fromEntries(form));
  if (!d.success || (d.data.email && !z.string().email().safeParse(d.data.email).success)) return back(scope, { error: "Γράψε ονοματεπώνυμο και, αν υπάρχει, σωστό email" });
  // αν το email ανήκει σε χρήστη αυτού του επιπέδου, το αίτημα δένεται με τον λογαριασμό του
  const user = d.data.email ? await db.user.findUnique({ where: { email: d.data.email }, include: { memberships: true } }) : null;
  const mine = user && scopeOf(user) === scope ? user : null;
  const customer = !mine && scope && d.data.email ? await db.party.findFirst({ where: { orgId: scope, email: { equals: d.data.email, mode: "insensitive" } } }) : null;
  try {
    await requestErasure({ orgId: scope, subjectType: mine ? "user" : customer ? "customer" : "external", subjectId: mine?.id ?? customer?.id ?? null, name: mine?.name ?? customer?.name ?? d.data.name, email: d.data.email || null, reason: d.data.reason, actor });
  } catch (e) {
    return back(scope, { error: say(e) });
  }
  revalidatePath(base(scope));
  back(scope, { ok: "Το αίτημα καταχωρίστηκε. Η προθεσμία απάντησης είναι 30 ημέρες" });
}

export async function completeRequest(id: string) {
  const { scope, actor } = await owned(id);
  // το redirect πετά εξαίρεση: γίνεται ΜΕΤΑ το try, όχι μέσα του
  const result = await completeErasure(id, actor).then(
    (s) => ({ ok: `Η διαγραφή ολοκληρώθηκε${s.account ? ": ο λογαριασμός σβήστηκε" : ""}${s.files ? ` · ${s.files} αρχεία` : ""}` }),
    (e) => {
      if (!(e instanceof GdprError)) console.error("erasure", e);
      return { error: say(e) };
    },
  );
  revalidatePath(base(scope));
  back(scope, result);
}

export async function rejectRequest(id: string, form: FormData) {
  const { scope, actor } = await owned(id);
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (note.length < 10) return back(scope, { error: "Γράψε τον λόγο της απόρριψης (τουλάχιστον 10 χαρακτήρες): τον διαβάζει το πρόσωπο που έκανε το αίτημα" });
  try {
    await rejectErasure(id, note, actor);
  } catch (e) {
    return back(scope, { error: say(e) });
  }
  revalidatePath(base(scope));
  back(scope, { ok: "Το αίτημα απορρίφθηκε και ο λόγος καταγράφηκε" });
}

// ---- Ο ίδιος ο χρήστης, για τα δικά του δεδομένα ----

const me = async () => { const user = await requireUser(); return { user, label: `${user.name} · ${user.email}`, actor: { id: user.id, name: user.name } }; };

export async function setMyConsent(purpose: string, granted: boolean) {
  const { user, label, actor } = await me();
  if (!isPurpose(purpose) || PURPOSES[purpose].audience !== "user" || PURPOSES[purpose].required) redirect("/my-data");
  await recordConsent({ orgId: scopeOf(user), subjectType: "user", subjectId: user.id, subjectLabel: label, purpose, granted, source: "self", actor }).catch(() => {});
  revalidatePath("/my-data");
  redirect("/my-data?saved=1");
}

export async function acceptLegal(form: FormData) {
  const { user, label, actor } = await me();
  if (form.get("accept") !== "on") redirect("/consent?error=1");
  await recordConsent({ orgId: scopeOf(user), subjectType: "user", subjectId: user.id, subjectLabel: label, purpose: "legal", granted: true, source: "self", actor }).catch(() => {});
  redirect("/");
}

export async function requestMyErasure(form: FormData) {
  const { user, actor } = await me();
  if (form.get("confirm") !== "on") redirect("/my-data?error=confirm");
  try {
    await requestErasure({ orgId: scopeOf(user), subjectType: "user", subjectId: user.id, name: user.name, email: user.email, reason: String(form.get("reason") ?? "").trim().slice(0, 500), actor });
  } catch (e) {
    redirect(`/my-data?error=${encodeURIComponent(say(e))}`);
  }
  revalidatePath("/my-data");
  redirect("/my-data?requested=1");
}

export async function logoutAfterDecline() {
  await endSession();
  redirect("/login");
}
