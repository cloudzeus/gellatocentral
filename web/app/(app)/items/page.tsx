import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveGenericItem, toggleGenericItem } from "./actions";

// Γενικά είδη: αυτά που μπαίνουν στις συνταγές. Κάθε ένα δένει με συσκευασίες του κεντρικού
// καταλόγου και προμηθευτές — η σύνδεση γίνεται στην καρτέλα του είδους.
export default async function ItemsPage({ searchParams }: PageProps<"/items">) {
  const { org, can } = await currentOrg("items.read");
  const q = await searchParams;
  const [items, units, vatRates] = await Promise.all([
    db.genericItem.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" }, include: { baseUnit: true, vatRate: true, _count: { select: { mappings: true } } } }),
    db.unit.findMany({ where: { active: true }, orderBy: [{ dimension: "asc" }, { toBase: "asc" }] }),
    db.vatRate.findMany({ where: { active: true }, orderBy: { rate: "desc" } }),
  ]);

  const itemForm = (g?: (typeof items)[number]) => (
    <form key={g?.id ?? "new"} action={saveGenericItem} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="genericItemId" value={g?.id ?? ""} />
      <Field label="Όνομα είδους" name="name" required minLength={2} maxLength={80} defaultValue={g?.name} hint="Γενικά, όπως θα μπαίνει στη συνταγή: «γάλα φρέσκο», «ζάχαρη άχνη»" />
      <Select label="Μονάδα κατανάλωσης" name="baseUnitId" defaultValue={g?.baseUnitId ?? units.find((u) => u.code === "g")?.id} options={units.map((u): [string, string] => [u.id, `${u.nameEL} (${u.code})`])} />
      <Select label="ΦΠΑ αγοράς" name="vatRateId" defaultValue={g?.vatRateId ?? ""} options={[["", "— χωρίς προεπιλογή —"], ...vatRates.map((v): [string, string] => [v.id, `${v.name} ${v.rate}%`])]} />
      <Submit className={btn("default")}>{g ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Συνταγολόγιο" title="Γενικά είδη" description="Τα είδη των συνταγών και η σύνδεσή τους με συσκευασίες και προμηθευτές. Τα κρυμμένα δεν προτείνονται σε νέες συνδέσεις"
      actions={can("items.add") ? <Modal label={<><Plus /> Νέο είδος</>} size="sm" title="Νέο γενικό είδος">{itemForm()}</Modal> : null}>
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Τα είδη ενημερώθηκαν</p> : null}
        {items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Κανένα γενικό είδος ακόμα. Ξεκίνα με «Νέο είδος» και μετά σύνδεσέ το με συσκευασίες από τον κεντρικό κατάλογο</Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Είδος</th><th className="px-3 py-2 font-semibold">Μονάδα</th><th className="px-3 py-2 font-semibold">ΦΠΑ αγοράς</th><th className="px-3 py-2 font-semibold">Συσκευασίες</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
              <tbody>
                {items.map((g) => (
                  <tr key={g.id} className={cn("border-t border-border/70", g.active ? "" : "text-muted-foreground")}>
                    <td className="px-5 py-2 font-medium"><Link href={`/items/${g.id}`} className="hover:underline">{g.name}</Link></td>
                    <td className="px-3 py-2">{g.baseUnit.nameEL} ({g.baseUnit.code})</td>
                    <td className="px-3 py-2">{g.vatRate ? `${g.vatRate.name} ${g.vatRate.rate}%` : "—"}</td>
                    <td className="px-3 py-2">{g._count.mappings ? `${g._count.mappings} συνδεδεμένες` : "καμία"}</td>
                    <td className="px-3 py-2">{g.active ? <Badge tone="success">Ενεργό</Badge> : <Badge>Κρυφό</Badge>}</td>
                    <td className="px-5 py-1.5">
                      <span className="flex justify-end gap-1">
                        {can("items.edit") ? <><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={g.name}>{itemForm(g)}</Modal><form action={toggleGenericItem.bind(null, g.id)}><Submit className={btn("ghost", "sm")}>{g.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">Η μονάδα κατανάλωσης ορίζει πώς μετράται το είδος στις συνταγές· οι συσκευασίες «σπάνε» αυτόματα σε αυτή τη μονάδα</p>
      </div>
    </Page>
  );
}
