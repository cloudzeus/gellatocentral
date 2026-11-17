// Η συνομιλία ενός αιτήματος και η φόρμα απάντησης. Κοινή για τον πελάτη και την υποστήριξη:
// ο πελάτης δεν βλέπει ποτέ τις εσωτερικές σημειώσεις (φιλτράρονται εδώ, στον server).
import { reply } from "@/app/(app)/support/actions";
import { Files } from "./files";
import { Submit } from "./submit";
import { btn, Card, cn } from "./ui";

type Message = { id: string; authorKind: string; authorName: string; body: string; internal: boolean; createdAt: Date };
const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
const KIND: Record<string, string> = { customer: "πελάτης", support: "υποστήριξη", system: "" };

export function TicketThread({ ticket, messages, support, closed }: { ticket: { id: string; orgId: string }; messages: Message[]; support: boolean; closed: boolean }) {
  const visible = support ? messages : messages.filter((m) => !m.internal);
  return (
    <div className="space-y-4">
      {visible.map((m) => (
        <Card key={m.id} className={cn("space-y-2 px-5 py-4", m.internal && "border-dashed bg-gold/8", m.authorKind === "system" && "border-transparent bg-transparent px-1 py-0 shadow-none")}>
          {m.authorKind === "system" ? <p className="text-xs text-muted-foreground">{when.format(m.createdAt)} · {m.body}</p> : (
            <>
              <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{m.authorName}</span> · {m.internal ? "εσωτερική σημείωση" : KIND[m.authorKind]} · {when.format(m.createdAt)}</p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </>
          )}
        </Card>
      ))}

      <Card>
        <div className="border-b border-border px-5 py-3"><h2 className="text-base">Συνημμένα</h2></div>
        <div className="p-5"><Files orgId={ticket.orgId} category="ticket_attachment" refType="ticket" refId={ticket.id} readOnly={closed} empty="Κανένα συνημμένο. Μια φωτογραφία της οθόνης βοηθά να το λύσουμε πιο γρήγορα" /></div>
      </Card>

      {closed ? <p className="rounded-lg bg-secondary px-4 py-3 text-muted-foreground">Το αίτημα έχει κλείσει. Για κάτι νέο άνοιξε νέο αίτημα</p> : (
        <Card className="p-5">
          <form action={reply.bind(null, ticket.id)} className="space-y-3">
            <label className="block space-y-1 font-medium">{support ? "Απάντηση" : "Η απάντησή σου"}
              <textarea name="body" required minLength={2} maxLength={4000} rows={4} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-normal" placeholder={support ? "Γράψε απλά: τι φταίει, τι να κάνει ο πελάτης, τι θα κάνεις εσύ" : "Γράψε τι βλέπεις ή τι δοκίμασες"} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {support ? <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="internal" className="size-4 accent-[var(--primary)]" /> Εσωτερική σημείωση (ο πελάτης δεν τη βλέπει)</label> : null}
              <span className="flex-1" />
              <Submit className={btn("default")}>Αποστολή</Submit>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
