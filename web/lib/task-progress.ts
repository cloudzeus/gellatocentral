// Η καθαρή λογική του παραθύρου «Εργασίες»: κατάληξη, κείμενα προόδου, τι βλέπει ο χρήστης. Χωρίς βάση, για node --test.
// Κανόνας: ποτέ επινοημένο ποσοστό ή εκτίμηση χρόνου — μόνο ό,τι μέτρησε πραγματικά ο βρόχος της εργασίας.

export type TaskStatus = "RUNNING" | "DONE" | "PARTIAL" | "FAILED";
export type TaskFailure = { id?: string; label: string; reason: string };
/** Ό,τι χρειάζεται ένας βρόχος για να πει πού βρίσκεται. Προαιρετικό όρισμα: χωρίς αυτό (π.χ. από cron) ο βρόχος τρέχει όπως πάντα. */
export type TaskReporter = { step(current: string): Promise<void>; ok(n?: number): Promise<void>; fail(failure: TaskFailure): Promise<void> };
export type TaskRow = {
  id: string; userId: string; kind: string; title: string; status: string; total: number | null; done: number; failed: number;
  current: string | null; error: string | null; resultHref: string | null; failures: unknown; seenAt: Date | null;
  startedAt: Date; heartbeatAt: Date; finishedAt: Date | null;
};
/** Ό,τι στέλνεται στον browser: έτοιμα κείμενα, καμία εσωτερική λεπτομέρεια. */
export type TaskView = {
  id: string; title: string; status: TaskStatus; mine: boolean; unseen: boolean;
  counted: boolean; done: number; total: number | null; progress: string | null; current: string | null; elapsed: string | null;
  finished: string | null; summary: string | null; error: string | null; resultHref: string | null; failuresHref: string | null; canRetry: boolean;
};

/** Εργασία που «τρέχει» χωρίς σημάδι ζωής τόσο καιρό έχει διακοπεί (π.χ. επανεκκίνηση του server). */
export const STALE_MS = 10 * 60_000;
export const STALE_REASON = "Η εργασία διακόπηκε πριν τελειώσει. Έλεγξε τι πρόλαβε να γίνει πριν την ξανατρέξεις.";
/** Οι βρόχοι γράφουν πρόοδο το πολύ κάθε τόσο, ώστε χιλιάδες βήματα να μη γίνουν χιλιάδες εγγραφές. */
export const FLUSH_MS = 400;
export const shouldFlush = (lastFlushAt: number, now: number) => now - lastFlushAt >= FLUSH_MS;

/** Πώς κατέληξε: όλα καλά, μερικά απέτυχαν, ή τίποτα δεν έγινε. Αν η εργασία «έσκασε», απέτυχε ολόκληρη. */
export function finalStatus(c: { done: number; failed: number; threw: boolean }): Exclude<TaskStatus, "RUNNING"> {
  if (c.threw) return "FAILED";
  if (!c.failed) return "DONE";
  return c.done > 0 ? "PARTIAL" : "FAILED";
}

/** Λόγος αποτυχίας σε απλά λόγια: τα δικά μας μηνύματα είναι ελληνικά· ό,τι τεχνικό δεν φτάνει ποτέ στην οθόνη. */
export function plainReason(error: unknown): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (/[Α-Ωα-ωά-ώ]/.test(message) && !/Error:|Exception|prisma|ECONN|ETIMEDOUT|\bundefined\b|\bnull\b|\n\s+at /i.test(message)) return message.trim().slice(0, 240);
  return "Κάτι δεν πήγε καλά στον server. Δοκίμασε ξανά· αν επιμένει, γράψε στην υποστήριξη.";
}

export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `Τρέχει εδώ και ${s} δευτ.`;
  const minutes = Math.floor(s / 60);
  return `Τρέχει εδώ και ${minutes} ${minutes === 1 ? "λεπτό" : "λεπτά"}`;
}

const clock = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Athens" });
export const failuresOf = (value: unknown): TaskFailure[] =>
  Array.isArray(value) ? value.filter((f): f is TaskFailure => !!f && typeof f === "object" && typeof (f as TaskFailure).label === "string" && typeof (f as TaskFailure).reason === "string") : [];

/** Η γραμμή της εργασίας όπως τη βλέπει ο χρήστης `viewerId` τη στιγμή `now`. `retryable`: το είδος έχει ασφαλές «Ξανά». */
export function taskView(row: TaskRow, viewerId: string, now: Date, retryable: boolean): TaskView {
  const stale = row.status === "RUNNING" && now.getTime() - row.heartbeatAt.getTime() > STALE_MS;
  const status: TaskStatus = stale ? "FAILED" : (["RUNNING", "DONE", "PARTIAL", "FAILED"] as const).find((s) => s === row.status) ?? "FAILED";
  const counted = row.total !== null && row.total > 0;
  const attempted = row.done + row.failed;
  const mine = row.userId === viewerId;
  const running = status === "RUNNING";
  const failures = failuresOf(row.failures);
  return {
    id: row.id, title: row.title, status, mine,
    unseen: mine && (status === "FAILED" || status === "PARTIAL") && !row.seenAt,
    counted, done: row.done, total: row.total,
    progress: running && counted ? `${attempted} από ${row.total}` : null,
    current: running && row.current ? `Τώρα: ${row.current}` : null,
    elapsed: running && !counted ? elapsedLabel((now.getTime() - row.startedAt.getTime()) / 1000) : null,
    finished: running ? null : clock.format(row.finishedAt ?? row.heartbeatAt),
    summary: status === "PARTIAL" ? `${row.done} από ${counted ? row.total : attempted} έγιναν` : null,
    error: status === "FAILED" ? (stale ? STALE_REASON : row.error ?? plainReason(null)) : null,
    resultHref: status === "DONE" || status === "PARTIAL" ? row.resultHref : null,
    failuresHref: failures.length ? `/tasks/${row.id}` : null,
    // «Ξανά» μόνο για ό,τι απέτυχε και μόνο όπου το είδος της εργασίας το δηλώνει ασφαλές· ποτέ για διακοπή στη μέση
    canRetry: retryable && !stale && (status === "FAILED" || status === "PARTIAL") && failures.some((f) => f.id),
  };
}

/** Πρώτα όσες τρέχουν, μετά οι πιο πρόσφατες. */
export const byRunningThenRecent = (a: TaskView & { startedAt: number }, b: TaskView & { startedAt: number }) =>
  Number(b.status === "RUNNING") - Number(a.status === "RUNNING") || b.startedAt - a.startedAt;
