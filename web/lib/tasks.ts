// Παράθυρο «Εργασίες»: ό,τι κρατά πάνω από δύο δευτερόλεπτα γράφει την πορεία του στον πίνακα TaskRun.
// Η εργασία τρέχει όπως πριν μέσα στο αίτημα που την ξεκίνησε· εδώ ΜΟΝΟ αναφέρεται η πρόοδος. Αν η αναφορά
// αποτύχει (π.χ. η βάση δεν απαντά), η εργασία συνεχίζει κανονικά: η πρόοδος δεν επιτρέπεται να χαλάσει τη δουλειά.
import { getUser, memberPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { platformCan, type PlatformPermission } from "@/lib/permissions";
import { accessFor } from "@/lib/plan-data";
import { byRunningThenRecent, finalStatus, plainReason, shouldFlush, STALE_MS, STALE_REASON, taskView, type TaskFailure, type TaskView } from "@/lib/task-progress";

export type TaskOwner = { orgId: string | null; userId: string; userName: string };
export type TaskSpec = { kind: string; title: string; /** δικαίωμα που χρειάζεται όποιος τη βλέπει */ permission: string; /** πόσα βήματα, αν μετριούνται */ total?: number | null };
export type TaskHandle = {
  /** Πριν από κάθε αντικείμενο: «Τώρα: …». */
  step(current: string): Promise<void>;
  /** Ένα (ή n) αντικείμενα έγιναν. */
  ok(n?: number): Promise<void>;
  /** Ένα αντικείμενο απέτυχε· με `id`, το «Ξανά» μπορεί να το ξανατρέξει. */
  fail(failure: TaskFailure): Promise<void>;
  /** Τα βήματα έγιναν γνωστά αφού ξεκίνησε η εργασία. */
  total(n: number): Promise<void>;
  /** Πού βλέπει ο χρήστης το αποτέλεσμα. */
  result(href: string): void;
};

const HOUR = 3_600_000;
const quiet = async (write: () => Promise<unknown>) => { try { await write(); } catch (error) { console.error("task progress", error); } };

/**
 * Τρέχει τη `work` και γράφει την πορεία της. Ό,τι πετάξει η `work` ξαναπετιέται ως έχει, ώστε ο χειρισμός λαθών
 * του καλούντος να μείνει ίδιος. Μην καλείς redirect() μέσα στη `work`.
 */
export async function runTask<R>(owner: TaskOwner, spec: TaskSpec, work: (task: TaskHandle) => Promise<R>): Promise<R> {
  let id: string | null = null;
  await quiet(async () => {
    id = (await db.taskRun.create({ data: { orgId: owner.orgId, userId: owner.userId, userName: owner.userName, kind: spec.kind, title: spec.title, permission: spec.permission, total: spec.total ?? null }, select: { id: true } })).id;
  });
  const state = { done: 0, failed: 0, total: spec.total ?? null, current: null as string | null, failures: [] as TaskFailure[], resultHref: null as string | null, flushedAt: 0 };
  const flush = async (force = false) => {
    if (!id || (!force && !shouldFlush(state.flushedAt, Date.now()))) return;
    state.flushedAt = Date.now();
    const taskId = id;
    await quiet(() => db.taskRun.update({ where: { id: taskId }, data: { done: state.done, failed: state.failed, total: state.total, current: state.current, heartbeatAt: new Date() } }));
  };
  const handle: TaskHandle = {
    step: async (current) => { state.current = current.slice(0, 120); await flush(); },
    ok: async (n = 1) => { state.done += n; await flush(); },
    fail: async (failure) => { state.failed++; if (state.failures.length < 200) state.failures.push({ id: failure.id, label: failure.label.slice(0, 120), reason: plainReason(failure.reason) }); await flush(); },
    total: async (n) => { state.total = n; await flush(true); },
    result: (href) => { state.resultHref = href; },
  };
  const finish = async (threw: boolean, error: string | null) => {
    if (!id) return;
    const taskId = id;
    const status = finalStatus({ done: state.done, failed: state.failed, threw });
    await quiet(() => db.taskRun.update({ where: { id: taskId }, data: {
      status, done: state.done, failed: state.failed, total: state.total, current: null, resultHref: state.resultHref,
      error: status === "FAILED" ? error ?? state.failures[0]?.reason ?? null : null,
      failures: state.failures.length ? (state.failures as Prisma.InputJsonValue) : undefined,
      heartbeatAt: new Date(), finishedAt: new Date(),
    } }));
  };
  try {
    const result = await work(handle);
    await finish(false, null);
    return result;
  } catch (error) {
    await finish(true, plainReason(error));
    throw error;
  }
}

/** Τι επιτρέπεται να δει ο χρήστης: εργασίες της επιχείρησής του με δικαίωμα που έχει, ή της πλατφόρμας αν είναι προσωπικό της. */
async function viewerScope() {
  const user = await getUser();
  if (!user) return null;
  const m = user.memberships[0];
  const scopes: Prisma.TaskRunWhereInput[] = [];
  if (m) {
    const access = await accessFor(m.orgId, m.stores.map((s) => s.storeId));
    scopes.push({ orgId: m.orgId, permission: { in: memberPermissions(m, access.open) } });
  }
  if (user.platformRole) {
    const kinds = await db.taskRun.findMany({ where: { orgId: null }, distinct: ["permission"], select: { permission: true } });
    scopes.push({ orgId: null, permission: { in: kinds.map((k) => k.permission).filter((p) => platformCan(user, p as PlatformPermission)) } });
  }
  return scopes.length ? { user, where: { OR: scopes } satisfies Prisma.TaskRunWhereInput } : null;
}

/** Όσες εργασίες «τρέχουν» χωρίς σημάδι ζωής κλείνουν ως διακομμένες, για να μη μένει για πάντα «1 τρέχει». */
const closeStale = () => quiet(() => db.taskRun.updateMany({ where: { status: "RUNNING", heartbeatAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: "FAILED", error: STALE_REASON, finishedAt: new Date() } }));

export type TaskList = { tasks: TaskView[]; running: number; total: number; unseen: number; userId: string };
/** Οι εργασίες του τελευταίου 24ώρου για το παράθυρο: οι `limit` πρώτες (πρώτα όσες τρέχουν) και τα σύνολα. */
export async function listTasks(retryable: (kind: string) => boolean, limit = 5): Promise<TaskList | null> {
  const scope = await viewerScope();
  if (!scope) return null;
  await closeStale();
  const now = new Date();
  const where = { AND: [scope.where, { startedAt: { gte: new Date(now.getTime() - 24 * HOUR) } }] };
  // shortcut: ως 50 εργασίες του 24ώρου στη μνήμη για τη σειρά «πρώτα όσες τρέχουν»· το πλήρες ιστορικό είναι η σελίδα /tasks με σελίδες στη βάση
  const [rows, total] = await Promise.all([db.taskRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 50 }), db.taskRun.count({ where })]);
  const views = rows.map((row) => ({ ...taskView(row, scope.user.id, now, retryable(row.kind)), startedAt: row.startedAt.getTime() })).sort(byRunningThenRecent);
  return {
    tasks: views.slice(0, limit),
    running: views.filter((v) => v.status === "RUNNING").length,
    total, unseen: views.filter((v) => v.unseen).length, userId: scope.user.id,
  };
}

/** Ιστορικό με σελίδες στη βάση (σελίδα /tasks). */
export async function taskHistory(retryable: (kind: string) => boolean, page: { skip: number; take: number; q: string }) {
  const scope = await viewerScope();
  if (!scope) return null;
  await closeStale();
  const now = new Date();
  const where = { AND: [scope.where, ...(page.q ? [{ OR: [{ title: { contains: page.q, mode: "insensitive" as const } }, { userName: { contains: page.q, mode: "insensitive" as const } }] }] : [])] };
  const [rows, total] = await Promise.all([db.taskRun.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: page.skip, take: page.take }), db.taskRun.count({ where })]);
  return { total, rows: rows.map((row) => ({ view: taskView(row, scope.user.id, now, retryable(row.kind)), userName: row.userName, startedAt: row.startedAt })) };
}

/** Μία εργασία που επιτρέπεται να δει ο χρήστης (για «Δες ποιες απέτυχαν» και «Ξανά»). */
export async function findTask(id: string) {
  const scope = await viewerScope();
  if (!scope) return null;
  const row = await db.taskRun.findFirst({ where: { AND: [scope.where, { id }] } });
  return row ? { row, user: scope.user } : null;
}

/** Ο χρήστης άνοιξε το παράθυρο: οι αποτυχίες του δεν είναι πια «αδιάβαστες». */
export async function markTasksSeen() {
  const user = await getUser();
  if (!user) return;
  await db.taskRun.updateMany({ where: { userId: user.id, seenAt: null, status: { in: ["FAILED", "PARTIAL"] } }, data: { seenAt: new Date() } });
}
