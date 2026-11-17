import { CircleCheck, MonitorUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { TicketThread } from "@/components/ticket-thread";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEVICE_KIND, readingStatus } from "@/lib/devices";
import { showRemoteId } from "@/lib/remote";
import { ACTIVE, CATEGORIES, type Category, PRIORITY, type Priority, responseClock, STATUS, type Status } from "@/lib/support/rules";
import { assignToMe, resolve, setPriority } from "@/app/(app)/support/actions";
import { startRemote } from "../../actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { reply: "Το μήνυμα καταχωρίστηκε", resolved: "Το αίτημα σημειώθηκε ως λυμένο", assigned: "Το αίτημα ανατέθηκε σε σένα", priority: "Η προτεραιότητα άλλαξε" };
const DOT = { success: "bg-success", warning: "bg-gold", danger: "bg-destructive", neutral: "bg-muted-foreground/40" };

export default async function SupportTicketPage({ params, searchParams }: PageProps<"/platform/support/[id]">) {
  const me = await requirePlatform("support.tickets");
  const ticket = await db.ticket.findUnique({ where: { id: (await params).id }, include: { org: { include: { subscription: true } }, messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket) notFound();
  const q = await searchParams;
  const status = ticket.status as Status, priority = ticket.priority as Priority;
  const [devices, unsent, others] = await Promise.all([
    db.device.findMany({ where: { store: { orgId: ticket.orgId }, active: true }, orderBy: { createdAt: "asc" }, include: { store: true, readings: { orderBy: { at: "desc" }, take: 1 } } }),
    db.fiscalDocument.count({ where: { sale: { orgId: ticket.orgId, status: "COMPLETED" }, status: { not: "SIGNED" } } }),
    db.ticket.findMany({ where: { orgId: ticket.orgId, id: { not: ticket.id } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const device = devices.find((d) => d.id === ticket.deviceId);
  const clock = responseClock({ ...ticket, priority, status });
  const sub = ticket.org.subscription;
  // Η κατάσταση της επιχείρησης αυτή τη στιγμή, ώστε ο υπάλληλος να μη χρειάζεται να ρωτήσει τα βασικά
  const facts: { tone: keyof typeof DOT; text: string; detail?: string }[] = [
    { tone: sub && sub.currentPeriodEnd > new Date() ? "success" : "danger", text: sub ? (sub.currentPeriodEnd > new Date() ? "Συνδρομή σε ισχύ" : "Η συνδρομή έχει λήξει") : "Χωρίς συνδρομή", detail: sub ? `έως ${day.format(sub.currentPeriodEnd)}` : undefined },
    { tone: unsent ? "danger" : "success", text: unsent ? `${unsent} ${unsent === 1 ? "απόδειξη δεν διαβιβάστηκε" : "αποδείξεις δεν διαβιβάστηκαν"} στην ΑΑΔΕ` : "Όλες οι αποδείξεις έχουν διαβιβαστεί" },
    ...devices.flatMap((d) => {
      const st = DEVICE_KIND[d.kind].measures ? readingStatus(d, d.readings[0]) : null;
      if (st && d.readings[0] && st.tone !== "success" && st.tone !== "neutral") return [{ tone: st.tone, text: `${d.name}: ${st.text}`, detail: d.store.name }];
      if (d.kind !== "POS_WEB" && !d.pairedAt) return [{ tone: "warning" as const, text: `${d.name}: δεν έχει συζευχθεί`, detail: d.store.name }];
      return [];
    }),
  ];

  return (
    <Page section="Πλατφόρμα › Αιτήματα" title={ticket.subject} description={`#${ticket.number} · ${ticket.org.name}${device ? ` · ${device.name}` : ""} · ${CATEGORIES[ticket.category as Category] ?? ticket.category} · το άνοιξε ο χρήστης ${ticket.openedByName}`}
      actions={<>
        <Badge tone={PRIORITY[priority].tone}>{PRIORITY[priority].label}</Badge><Badge tone={clock.tone}>{clock.text}</Badge>
        {ticket.assigneeId === me.id ? null : <form action={assignToMe.bind(null, ticket.id)}><Submit className={btn("outline")}>Ανάθεση σε μένα</Submit></form>}
        {ACTIVE.includes(status) ? <form action={resolve.bind(null, ticket.id)}><Submit className={btn("default")}><CircleCheck /> Λύθηκε</Submit></form> : null}
      </>}>
      <div className="grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
          {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 200)}</p> : null}
          <TicketThread ticket={ticket} messages={ticket.messages} support closed={status === "CLOSED"} />
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex items-center gap-3 px-5 pt-4 pb-3"><h2 className="min-w-0 flex-1 text-base">Το αίτημα</h2><Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge></div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-5 py-4">
              <div><dt className="text-xs font-medium text-muted-foreground">Ανάθεση</dt><dd className="font-semibold">{ticket.assigneeName ?? "Κανείς ακόμα"}</dd></div>
              <div><dt className="text-xs font-medium text-muted-foreground">Βαθμολογία πελάτη</dt><dd className="font-semibold">{ticket.rating ? `${ticket.rating} από 5` : "—"}</dd></div>
            </dl>
            <form key={priority} action={setPriority.bind(null, ticket.id)} className="flex items-end gap-2 border-t border-border px-5 py-4">
              <div className="min-w-0 flex-1"><Select label="Προτεραιότητα" name="priority" defaultValue={priority} options={Object.entries(PRIORITY).map(([k, v]): [string, string] => [k, v.label])} /></div>
              <Submit className={btn("outline")}>Αλλαγή</Submit>
            </form>
          </Card>
          <Card>
            <div className="flex items-baseline gap-3 px-5 pt-4 pb-3"><h2 className="min-w-0 flex-1 text-base">Η επιχείρηση τώρα</h2><Link href={`/platform/${ticket.orgId}`} className="text-sm font-semibold text-primary hover:underline">Καρτέλα</Link></div>
            <ul>{facts.map((f) => <li key={f.text} className="flex min-h-11 items-center gap-3 border-t border-border px-5 py-1.5"><span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[f.tone]}`} /><span className="min-w-0 flex-1"><span className="block font-medium">{f.text}</span>{f.detail ? <span className="block text-xs text-muted-foreground">{f.detail}</span> : null}</span></li>)}</ul>
          </Card>
          <Card>
            <h2 className="px-5 pt-4 pb-3 text-base">Απομακρυσμένη σύνδεση</h2>
            <div className="space-y-3 border-t border-border px-5 py-4">
              {!device ? <p className="text-muted-foreground">Το αίτημα δεν αφορά συγκεκριμένη συσκευή. Η σύνδεση ξεκινά από την καρτέλα του πελάτη</p>
                : !device.remoteId ? <p className="text-muted-foreground">Η συσκευή «{device.name}» δεν έχει αριθμό RustDesk. Ορίζεται στην καρτέλα του πελάτη › Συσκευές</p>
                : !me.can("support.remote") ? <p className="text-muted-foreground">Ο ρόλος σου δεν επιτρέπει απομακρυσμένη σύνδεση</p>
                : (
                  <>
                    <p className="text-muted-foreground">{device.name} · RustDesk <span className="font-mono tabular-nums">{showRemoteId(device.remoteId)}</span></p>
                    <Modal label={<><MonitorUp /> Σύνδεση στο {device.name}</>} variant="default" title={`Απομακρυσμένη σύνδεση: ${device.name}`} description="Η σύνδεση καταγράφεται και ο πελάτης τη βλέπει στις Συσκευές του. Ο υπάλληλος πατά «Αποδοχή» στη συσκευή">
                      <form action={startRemote.bind(null, ticket.orgId, device.id)} className="grid gap-4 [&>button]:justify-self-end">
                        <Field label="Λόγος σύνδεσης" name="reason" required minLength={5} maxLength={300} defaultValue={`Αίτημα #${ticket.number}: ${ticket.subject}`.slice(0, 300)} />
                        <Submit className={btn("default")}>Καταγραφή και συνέχεια</Submit>
                      </form>
                    </Modal>
                  </>
                )}
            </div>
          </Card>
          <Card>
            <h2 className="px-5 pt-4 pb-3 text-base">Άλλα αιτήματα του πελάτη</h2>
            {others.length === 0 ? <p className="border-t border-border px-5 py-4 text-muted-foreground">Είναι το πρώτο του αίτημα</p> : (
              <ul>{others.map((o) => <li key={o.id} className="border-t border-border"><Link href={`/platform/support/${o.id}`} className="flex min-h-11 items-center gap-3 px-5 py-1.5 hover:bg-secondary"><span className="shrink-0 rounded-sm border border-dashed border-primary/30 bg-background px-1.5 py-0.5 font-mono text-xs font-medium">#{o.number}</span><span className="min-w-0 flex-1 truncate font-medium">{o.subject}</span><Badge tone={STATUS[o.status as Status].tone}>{STATUS[o.status as Status].label}</Badge></Link></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
