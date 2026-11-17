import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRefList, REF_LISTS, type RefList } from "@/lib/refs";
import { saveRef, toggleRef } from "../actions";

// Οι κοινές λίστες από τις οποίες διαλέγουν όλες οι επιχειρήσεις. Τις ορίζει μία φορά η πλατφόρμα.
export default async function RefsPage({ searchParams }: PageProps<"/platform/refs">) {
  await requirePlatform("settings.manage");
  const q = await searchParams;
  const list: RefList = isRefList(q.list) ? q.list : "paymentTerm";
  const [counts, items] = await Promise.all([db.refItem.groupBy({ by: ["list"], _count: true }), db.refItem.findMany({ where: { list }, orderBy: [{ sort: "asc" }, { label: "asc" }] })]);
  const def = REF_LISTS[list];
  const refForm = (item?: (typeof items)[number]) => (
    <form key={item ? `${item.code}-${item.label}-${item.value}` : "new"} action={saveRef} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="list" value={list} /><input type="hidden" name="refId" value={item?.id ?? ""} />
      <Field label="Κωδικός" name="code" required maxLength={20} defaultValue={item?.code} hint={def.hint} />
      <Field label="Περιγραφή" name="label" required maxLength={120} defaultValue={item?.label} />
      {def.value ? <Field label={def.value} name="value" type="number" defaultValue={item?.value ?? ""} /> : <input type="hidden" name="value" value="" />}
      <Submit className={btn("default")}>{item ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Ρυθμίσεις πλατφόρμας" title="Λίστες αναφοράς" description="Κοινές για όλους τους συνδρομητές. Τις ορίζεις μία φορά εδώ και οι επιχειρήσεις διαλέγουν από αυτές">
      <div className="grid max-w-7xl gap-4 lg:grid-cols-[20rem_1fr] lg:items-start">
        <Card>
          <ul className="divide-y divide-border/70">
            {(Object.keys(REF_LISTS) as RefList[]).map((k) => (
              <li key={k}>
                <Link href={`/platform/refs?list=${k}`} aria-current={k === list ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 px-5 py-2.5 hover:bg-secondary", k === list ? "bg-secondary font-semibold" : "")}>
                  <span className="min-w-0 flex-1">{REF_LISTS[k].label}<span className="block text-xs font-normal text-muted-foreground">{REF_LISTS[k].hint}</span></span>
                  <span className="tabular-nums text-muted-foreground">{counts.find((c) => c.list === k)?._count ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
          {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Η λίστα ενημερώθηκε</p> : null}
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1"><h2 className="text-lg">{def.label}</h2><p className="text-sm text-muted-foreground">{items.length ? `${items.filter((i) => i.active).length} ενεργές τιμές` : "Η λίστα είναι άδεια"}</p></div>
              <Modal label={<><Plus /> Νέα τιμή</>} size="sm" title={`Νέα τιμή: ${def.label}`}>{refForm()}</Modal>
            </div>
            {items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Κωδικός</th><th className="px-3 py-2 font-semibold">Περιγραφή</th>{def.value ? <th className="px-3 py-2 text-right font-semibold">{def.value}</th> : null}<th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className={cn("border-t border-border/70", i.active ? "" : "text-muted-foreground")}>
                        <td className="px-5 py-2 font-mono text-xs">{i.code}</td>
                        <td className="px-3 py-2 font-medium">{i.label}</td>
                        {def.value ? <td className="px-3 py-2 text-right tabular-nums">{i.value ?? "—"}</td> : null}
                        <td className="px-3 py-2">{i.active ? <Badge tone="success">Ενεργή</Badge> : <Badge>Κρυφή</Badge>}</td>
                        <td className="px-5 py-1.5"><span className="flex justify-end gap-1"><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={i.label}>{refForm(i)}</Modal><form action={toggleRef.bind(null, i.id)}><Submit className={btn("ghost", "sm")}>{i.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="px-5 py-6 text-sm text-muted-foreground">Καμία τιμή ακόμα. {list === "taxOffice" ? "Η ΔΟΥ κάθε συναλλασσόμενου έρχεται από την αναζήτηση ΑΦΜ· πρόσθεσε εδώ τιμές μόνο αν θες λίστα επιλογής" : "Πρόσθεσε την πρώτη με το «Νέα τιμή»"}</p>}
            <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Μια τιμή δεν σβήνεται, μόνο κρύβεται από τις νέες καταχωρίσεις: έτσι όσοι την έχουν ήδη δεν μένουν με κενό</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
