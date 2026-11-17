import { CircleCheck, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProcessFlow } from "@/components/process-flow";
import { Submit } from "@/components/submit";
import { TicketThread } from "@/components/ticket-thread";
import { Badge, btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { canView } from "@/lib/support";
import { CATEGORIES, type Category, STATUS, type Status } from "@/lib/support/rules";
import { rate, resolve } from "../actions";

const SAVED: Record<string, string> = { new: "Το αίτημα στάλθηκε. Θα σε ειδοποιήσουμε με email όταν απαντήσουμε", reply: "Το μήνυμά σου στάλθηκε", resolved: "Το αίτημα σημειώθηκε ως λυμένο", rated: "Ευχαριστούμε για τη βαθμολογία" };

export default async function TicketPage({ params, searchParams }: PageProps<"/support/[id]">) {
  const { user } = await currentOrg();
  const ticket = await db.ticket.findUnique({ where: { id: (await params).id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!ticket || !canView(user, ticket)) notFound();
  const q = await searchParams;
  const status = ticket.status as Status;
  const done = status === "RESOLVED" || status === "CLOSED";
  const order: Status[] = ["NEW", "OPEN", "RESOLVED"];
  const reached = status === "WAITING_CUSTOMER" ? 1 : status === "CLOSED" ? 2 : order.indexOf(status);

  return (
    <Page section="Υποστήριξη" title={ticket.subject} description={`Αίτημα #${ticket.number} · ${CATEGORIES[ticket.category as Category] ?? ticket.category} · το άνοιξε ο χρήστης ${ticket.openedByName}`}
      actions={<><Badge tone={STATUS[status].tone}>{STATUS[status].customer}</Badge>{done ? null : <form action={resolve.bind(null, ticket.id)}><Submit className={btn("outline")}><CircleCheck /> Λύθηκε</Submit></form>}<Link href="/support" className={btn("outline")}>Όλα τα αιτήματα</Link></>}>
      <div className="max-w-4xl space-y-4">
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 200)}</p> : null}
        <Card className="p-4">
          <ProcessFlow label="Πορεία αιτήματος" steps={[
            { id: "sent", label: "Το λάβαμε", state: "done" },
            { id: "work", label: status === "WAITING_CUSTOMER" ? "Περιμένουμε εσένα" : "Το δουλεύουμε", state: reached > 1 ? "done" : reached === 1 ? "current" : "todo", detail: status === "WAITING_CUSTOMER" ? "Διάβασε την απάντηση πιο κάτω" : ticket.assigneeName ? "Το έχει αναλάβει η υποστήριξη" : "Θα το αναλάβει σύντομα κάποιος" },
            { id: "done", label: "Λύθηκε", state: done ? "done" : "todo" },
          ]} />
        </Card>
        {done ? (
          <Card className="flex flex-wrap items-center gap-3 px-5 py-4">
            <p className="min-w-0 flex-1 font-medium">{ticket.rating ? `Βαθμολόγησες τη λύση με ${ticket.rating} από 5` : "Πόσο σε βοήθησε η λύση;"}{status === "RESOLVED" ? <span className="block text-sm font-normal text-muted-foreground">Αν το πρόβλημα συνεχίζεται, απάντησε πιο κάτω και το αίτημα ξανανοίγει</span> : null}</p>
            {ticket.rating ? null : <form action={rate.bind(null, ticket.id)} className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <Submit key={n} name="rating" value={n} aria-label={`${n} από 5`} className={btn("outline", "sm", "px-2")}><Star /> {n}</Submit>)}</form>}
          </Card>
        ) : null}
        <TicketThread ticket={ticket} messages={ticket.messages} support={false} closed={status === "CLOSED"} />
      </div>
    </Page>
  );
}
