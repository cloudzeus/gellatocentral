import { Submit } from "@/components/submit";
import { btn, Card, Field, TextareaField } from "@/components/ui";
import { getPublicRfq } from "@/lib/rfq-db";
import { submitQuote } from "./actions";

// Το περιεχόμενο εξαρτάται πάντα από το προσωπικό token και από τρέχοντα δεδομένα.
export const instant = false;

export default async function PublicRfqPage({ params, searchParams }: PageProps<"/rfq/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const data = await getPublicRfq(token);
  if (!data) return <main className="mx-auto max-w-2xl p-6"><Card className="p-6"><h1 className="text-xl font-semibold">Ο σύνδεσμος δεν είναι διαθέσιμος</h1><p className="mt-2 text-sm text-muted-foreground">Έχει λήξει ή έχει αντικατασταθεί. Ζήτα νέο σύνδεσμο από την επιχείρηση.</p></Card></main>;
  const names = new Map(data.generics.map((g) => [g.id, g.name]));
  return <main className="mx-auto max-w-3xl p-4 py-8 sm:p-6"><div className="mb-6"><p className="text-sm text-muted-foreground">{data.invitation.rfq.org.name}</p><h1 className="text-2xl font-semibold">Προσφορά {data.invitation.rfq.number}</h1><p className="mt-1 text-sm text-muted-foreground">Προμηθευτής: {data.party?.name} · Προθεσμία {new Intl.DateTimeFormat("el-GR").format(data.invitation.rfq.replyBy)}</p></div>{query.saved ? <p className="mb-4 rounded-lg bg-success/10 p-3 text-sm text-success-ink">Η προσφορά αποθηκεύτηκε. Μπορείς να την ενημερώσεις έως τη λήξη της προθεσμίας.</p> : null}{typeof query.error === "string" ? <p className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}{data.invitation.rfq.note ? <Card className="mb-4 p-4 text-sm">{data.invitation.rfq.note}</Card> : null}<form action={submitQuote} className="grid gap-4"><input type="hidden" name="token" value={token} />{data.invitation.rfq.lines.map((line) => <Card key={line.id} className="grid gap-3 p-4"><input type="hidden" name="rfqLineId" value={line.id} /><h2 className="font-semibold">{names.get(line.genericItemId)}</h2><p className="text-sm text-muted-foreground">Ζητούμενη ποσότητα: {line.quantityBase} {line.unitCode}</p><Field label={`Τιμή μονάδας € / ${line.unitCode}`} name={`price:${line.id}`} required inputMode="decimal" placeholder="0,0000" /><TextareaField label="Σημείωση" name={`note:${line.id}`} maxLength={300} /></Card>)}<Submit className={btn("default", "lg", "justify-self-end")} pendingText="Υποβολή…">Υποβολή προσφοράς</Submit></form></main>;
}
