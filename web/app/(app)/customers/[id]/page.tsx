import { Download, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customer-form";
import { Files } from "@/components/files";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { consentsOf } from "@/lib/gdpr";
import { currentConsents, daysLeft, DUE_DAYS, PURPOSES } from "@/lib/gdpr/rules";
import { requestCustomerErasure, setCustomerConsent } from "../actions";

const day = new Intl.DateTimeFormat("el-GR", { dateStyle: "long", timeZone: "Europe/Athens" });
const SAVED: Record<string, string> = { "1": "Τα στοιχεία αποθηκεύτηκαν", consent: "Η συναίνεση καταγράφηκε", erasure: `Το αίτημα διαγραφής καταχωρίστηκε. Απάντηση μέσα σε ${DUE_DAYS} ημέρες, από το «GDPR & συναινέσεις»` };

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const { org, permissions } = await currentOrg("customers.manage");
  const customer = await db.customer.findFirst({ where: { id: (await params).id, orgId: org.id } });
  if (!customer) notFound();
  const q = await searchParams;
  const [consents, request] = await Promise.all([
    consentsOf("customer", customer.id),
    db.erasureRequest.findFirst({ where: { orgId: org.id, subjectType: "customer", subjectId: customer.id, status: "PENDING" } }),
  ]);
  const marketing = currentConsents(consents).get("customer_marketing");
  const facts: [string, string | null][] = [
    ["ΑΦΜ", customer.vatNumber], ["ΔΟΥ", customer.taxOffice], ["Επάγγελμα", customer.profession],
    ["Υπεύθυνος επικοινωνίας", customer.contactName], ["Email", customer.email], ["Τηλέφωνο", customer.phone],
    ["Διεύθυνση", [customer.address, customer.postalCode, customer.city].filter(Boolean).join(", ") || null],
    ["Πίστωση", customer.paymentTermsDays ? `${customer.paymentTermsDays} ημέρες` : "Πληρωμή με την παράδοση"],
    ["Πελάτης από", day.format(customer.createdAt)],
  ];
  const missing = [!customer.vatNumber && "ΑΦΜ", !customer.email && "email", !customer.address && "διεύθυνση"].filter(Boolean);

  return (
    <Page section="Πελάτες & πωλήσεις › Πελάτες" title={customer.name} description={[customer.tradeName, customer.city].filter(Boolean).join(" · ") || undefined}
      actions={<><Badge tone={customer.active ? "success" : "neutral"}>{customer.active ? "Ενεργός" : "Ανενεργός"}</Badge><Link href="/customers" className={btn("outline")}>Όλοι οι πελάτες</Link></>}>
      <div className="max-w-5xl space-y-4">
        {typeof q.saved === "string" && SAVED[q.saved] ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{SAVED[q.saved]}</p> : null}
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{q.error.slice(0, 200)}</p> : null}

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Στοιχεία</h2>
              <p className="text-sm text-muted-foreground">{missing.length ? `Για τιμολόγιο λείπουν: ${missing.join(", ")}` : "Τα στοιχεία τιμολόγησης είναι πλήρη"}</p>
            </div>
            <Modal label={<><Pencil /> Αλλαγή</>} title="Στοιχεία πελάτη"><CustomerForm customer={customer} /></Modal>
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{l}</dt><dd className="font-semibold break-words">{v ?? <span className="font-normal text-muted-foreground">Δεν έχει συμπληρωθεί</span>}</dd></div>)}
          </dl>
          {customer.notes ? <p className="border-t border-border px-5 py-4 text-muted-foreground"><span className="font-medium text-foreground">Σημειώσεις:</span> {customer.notes}</p> : null}
        </Card>

        <Card>
          <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Έγγραφα</h2><p className="text-sm text-muted-foreground">Συμβάσεις, δικαιολογητικά, φωτογραφίες. Τα βλέπουν μόνο όσοι διαχειρίζονται πελάτες</p></div>
          <div className="p-5"><Files orgId={org.id} category="customer_document" refType="customer" refId={customer.id} empty="Κανένα έγγραφο ακόμα" /></div>
        </Card>

        <Card id="gdpr" className="scroll-mt-28">
          <div className="border-b border-border px-5 py-4"><h2 className="text-lg">Προσωπικά δεδομένα</h2><p className="text-sm text-muted-foreground">Τι έχει συμφωνήσει ο πελάτης και τα δικαιώματά του. Κάθε ενέργεια γράφεται στο ημερολόγιο GDPR</p></div>
          <ul className="divide-y divide-border">
            <li className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{PURPOSES.customer_marketing.label}</p><p className="text-sm text-muted-foreground">Καταχώρισε τη συναίνεση μόνο αν ο πελάτης την έδωσε ρητά (έντυπο, email). Χωρίς αυτήν δεν του στέλνεις προσφορές</p></div>
              <Badge tone={marketing?.granted ? "success" : "neutral"}>{marketing?.granted ? `Ναι, από ${day.format(marketing.at)}` : marketing ? `Ανακλήθηκε ${day.format(marketing.at)}` : "Δεν έχει δοθεί"}</Badge>
              <form action={setCustomerConsent.bind(null, customer.id, !marketing?.granted)}><Submit className={btn("outline", "sm")}>{marketing?.granted ? "Ανάκληση" : "Καταχώριση συναίνεσης"}</Submit></form>
            </li>
            <li className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium">Αντίγραφο των δεδομένων του</p><p className="text-sm text-muted-foreground">Αν ο πελάτης ζητήσει τι κρατάς για αυτόν, του δίνεις αυτό το αρχείο</p></div>
              <a href={`/api/customers/${customer.id}/export`} download className={btn("outline", "sm")}><Download /> Λήψη αντιγράφου</a>
            </li>
            <li className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Διαγραφή των δεδομένων του</p>
                <p className="text-sm text-muted-foreground">{request ? `Υπάρχει ανοιχτό αίτημα από ${day.format(request.requestedAt)}. ${daysLeft(request.dueAt) >= 0 ? `Απομένουν ${daysLeft(request.dueAt)} ημέρες για απάντηση` : "Η προθεσμία πέρασε"}` : "Αν ο πελάτης το ζητήσει, ανοίγεις αίτημα. Η διαγραφή σβήνει την καρτέλα και τα έγγραφά του"}</p>
              </div>
              {request ? (permissions.includes("gdpr.manage") ? <Link href="/gdpr" className={btn("outline", "sm")}>Στα αιτήματα διαγραφής</Link> : <Badge tone="warning">Σε εξέταση</Badge>) : (
                <Modal label={<><Trash2 /> Αίτημα διαγραφής</>} size="sm" variant="outline" title="Αίτημα διαγραφής πελάτη" description={`Το εξετάζει ο υπεύθυνος GDPR της επιχείρησης μέσα σε ${DUE_DAYS} ημέρες`}>
                  <form action={requestCustomerErasure.bind(null, customer.id)} className="grid gap-4 [&>button]:justify-self-end">
                    <Field label="Πώς ήρθε το αίτημα" name="reason" maxLength={500} hint="π.χ. με email στις 12/11. Σβήνεται όταν ολοκληρωθεί" />
                    <Submit className={btn("default")}>Άνοιγμα αιτήματος</Submit>
                  </form>
                </Modal>
              )}
            </li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
