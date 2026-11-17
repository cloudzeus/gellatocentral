import { Eye, Plus, Power } from "lucide-react";
import Link from "next/link";
import { CustomerForm } from "@/components/customer-form";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, Card, menuItem, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { toggleCustomer } from "./actions";

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const { org } = await currentOrg("customers.manage");
  const sp = await searchParams;
  const list = listParams(sp, 25, ["name", "city", "created"]);
  const status = filterParam(sp, "status", ["active", "inactive"]);
  const like = { contains: list.q, mode: "insensitive" as const };
  const where = {
    orgId: org.id,
    ...(status ? { active: status === "active" } : {}),
    ...(list.q ? { OR: [{ name: like }, { tradeName: like }, { vatNumber: { contains: list.q } }, { email: like }, { phone: { contains: list.q } }, { contactName: like }] } : {}),
  };
  const monthAgo = daysAgo(30);
  const [rows, total, active, recent, noEmail] = await Promise.all([
    db.customer.findMany({ where, orderBy: list.sort === "city" ? { city: list.dir } : list.sort === "created" ? { createdAt: list.dir } : { name: list.sort === "name" ? list.dir : "asc" }, skip: list.skip, take: list.take }),
    db.customer.count({ where }),
    db.customer.count({ where: { orgId: org.id, active: true } }),
    db.customer.count({ where: { orgId: org.id, createdAt: { gte: monthAgo } } }),
    db.customer.count({ where: { orgId: org.id, active: true, email: null } }),
  ]);
  const tiles = [
    { label: "Ενεργοί πελάτες", value: active, hint: active ? "Σε αυτούς μπορείς να εκδώσεις παραστατικό" : "Πρόσθεσε τον πρώτο με το «Νέος πελάτης»" },
    { label: "Νέοι τις τελευταίες 30 ημέρες", value: recent, hint: recent ? "Καρτέλες που ανοίχτηκαν πρόσφατα" : "Καμία νέα καρτέλα τον τελευταίο μήνα" },
    { label: "Ενεργοί χωρίς email", value: noEmail, hint: noEmail ? "Δεν θα λαμβάνουν παραστατικά με email: συμπλήρωσέ το στην καρτέλα τους" : "Όλοι οι ενεργοί έχουν email" },
  ];

  return (
    <Page section="Πελάτες & πωλήσεις" title="Πελάτες" description="Οι καρτέλες των πελατών: στοιχεία τιμολόγησης, επικοινωνία, έγγραφα και συναινέσεις"
      actions={<Modal label={<><Plus /> Νέος πελάτης</>} variant="default" title="Νέος πελάτης" description="Μόνο η επωνυμία είναι υποχρεωτική. Τα υπόλοιπα συμπληρώνονται και αργότερα"><CustomerForm /></Modal>}>
      <div className="max-w-7xl space-y-4">
        {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {sp.error.slice(0, 200)}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="px-5 py-4">
              <p className="font-medium text-muted-foreground">{t.label}</p>
              <p className="mt-1.5 text-3xl leading-tight font-semibold tabular-nums">{t.value}</p>
              <p className="mt-1.5 text-muted-foreground">{t.hint}</p>
            </Card>
          ))}
        </div>
        <Card>
          <DataTable
            id="customers"
            listing={{ ...list, total, placeholder: "Επωνυμία, ΑΦΜ, email ή τηλέφωνο", filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["inactive", "Ανενεργοί"]] }] }}
            empty="Κανένας πελάτης ακόμα. Πάτησε «Νέος πελάτης» για την πρώτη καρτέλα"
            columns={[
              { key: "name", label: "Πελάτης", required: true, sortable: true },
              { key: "vat", label: "ΑΦΜ" },
              { key: "contact", label: "Επικοινωνία" },
              { key: "city", label: "Πόλη", sortable: true },
              { key: "terms", label: "Πίστωση", numeric: true },
              { key: "status", label: "Κατάσταση" },
            ]}
            rows={rows.map((c) => ({
              id: c.id,
              cells: {
                name: <><Link href={`/customers/${c.id}`} className="font-semibold underline-offset-2 hover:underline">{c.name}</Link>{c.tradeName ? <span className="block text-xs text-muted-foreground">{c.tradeName}</span> : null}</>,
                vat: c.vatNumber ?? <span className="text-muted-foreground">—</span>,
                contact: c.phone || c.email ? <>{c.phone ?? c.email}{c.contactName ? <span className="block text-xs text-muted-foreground">{c.contactName}</span> : null}</> : <span className="text-muted-foreground">—</span>,
                city: c.city ?? <span className="text-muted-foreground">—</span>,
                terms: c.paymentTermsDays ? `${c.paymentTermsDays} ημ.` : "—",
                status: <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Ενεργός" : "Ανενεργός"}</Badge>,
              },
              menu: (
                <>
                  <Link href={`/customers/${c.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα καρτέλας</Link>
                  <form action={toggleCustomer.bind(null, c.id)}><Submit role="menuitem" className={menuItem}><Power /> {c.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form>
                </>
              ),
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
