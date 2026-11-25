import { Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { StatusBadge } from "@/components/status-badge";
import { DetailGrid, btn, Card, cn, Field, menuItem, Page } from "@/components/ui";
import { look } from "@/lib/status";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { isRefList, REF_LISTS, type RefList } from "@/lib/refs";
import { activateRefItems, hideRefItems, saveRef, toggleRef } from "../actions";

// Οι κοινές λίστες από τις οποίες διαλέγουν όλες οι επιχειρήσεις.
export default async function RefsPage({ searchParams }: PageProps<"/platform/refs">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list: RefList = isRefList(q.list) ? q.list : "paymentTerm";
  const paging = listParams(q, 50, ["code", "label", "value", "status", "sort"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const where = {
    list,
    ...(status ? { active: status === "active" } : {}),
    ...(paging.q ? { OR: [{ code: { contains: paging.q, mode: "insensitive" as const } }, { label: { contains: paging.q, mode: "insensitive" as const } }] } : {}),
  };
  const direction = paging.sort ? paging.dir : "asc";
  const orderBy = paging.sort === "code" ? { code: direction }
    : paging.sort === "label" ? { label: direction }
      : paging.sort === "value" ? { value: direction }
        : paging.sort === "status" ? { active: direction }
          : [{ sort: direction }, { label: "asc" as const }];
  const [counts, items, total, active] = await Promise.all([
    db.refItem.groupBy({ by: ["list"], _count: true }),
    db.refItem.findMany({ where, orderBy, skip: paging.skip, take: paging.take }),
    db.refItem.count({ where }),
    db.refItem.count({ where: { list, active: true } }),
  ]);
  const def = REF_LISTS[list];
  const refForm = (item?: (typeof items)[number]) => (
    <form key={item ? `${item.code}-${item.label}-${item.value}` : "new"} action={saveRef} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="list" value={list} /><input type="hidden" name="refId" value={item?.id ?? ""} />
      <Field label="Κωδικός" name="code" required maxLength={20} defaultValue={item?.code} hint={def.hint} />
      <Field label="Περιγραφή" name="label" required maxLength={120} defaultValue={item?.label} />
      {def.value ? <Field label={def.value} name="value" type="number" defaultValue={item?.value ?? ""} /> : <input type="hidden" name="value" value="" />}
      <FormPending label="Αποθήκευση τιμής…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{item ? "Αποθήκευση" : "Προσθήκη"}</Submit>
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
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0 flex-1"><h2 className="text-lg">{def.label}</h2><p className="text-sm text-muted-foreground">{total ? `${active} ενεργές τιμές στη λίστα` : "Η λίστα είναι άδεια"}</p></div>
              <Modal label={<><Plus /> Νέα τιμή</>} size="sm" title={`Νέα τιμή: ${def.label}`}>{refForm()}</Modal>
            </div>
            <DataTable
              id={`refs-${list}`}
              bulkActions={[
                { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateRefItems },
                { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων τιμών από τις νέες καταχωρίσεις;", run: hideRefItems },
              ]}
              listing={{ ...paging, total, placeholder: "Κωδικός ή περιγραφή…", params: { list }, filters: [{ key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργές"], ["hidden", "Κρυφές"]] }] }}
              empty={list === "taxOffice" ? "Η ΔΟΥ έρχεται από την αναζήτηση ΑΦΜ· πρόσθεσε τιμές μόνο αν θες λίστα επιλογής" : "Καμία τιμή ακόμα. Πρόσθεσε την πρώτη με «Νέα τιμή»"}
              columns={[
                { key: "code", label: "Κωδικός", required: true, sortable: true },
                { key: "label", label: "Περιγραφή", sortable: true },
                ...(def.value ? [{ key: "value", label: def.value, numeric: true, sortable: true }] : []),
                { key: "status", label: "Κατάσταση", sortable: true },
              ]}
              rows={items.map((i) => ({
                id: i.id,
                cells: {
                  code: <span className="font-mono text-xs">{i.code}</span>,
                  label: <span className="font-semibold">{i.label}</span>,
                  ...(def.value ? { value: i.value ?? "—" } : {}),
                  status: i.active ? <StatusBadge look={look("success", "Ενεργή")} /> : <StatusBadge look={look("neutral", "Κρυφή")} />,
                },
                details: {
                  label: i.label,
                  view: <DetailGrid className="sm:grid-cols-3">
                    <div><dt className="text-xs text-muted-foreground">Κωδικός</dt><dd className="font-mono text-xs">{i.code}</dd></div>
                    {def.value ? <div><dt className="text-xs text-muted-foreground">{def.value}</dt><dd className="font-medium tabular-nums">{i.value ?? "—"}</dd></div> : null}
                    <div><dt className="text-xs text-muted-foreground">Σειρά</dt><dd className="font-medium tabular-nums">{i.sort}</dd></div>
                  </DetailGrid>,
                  edit: refForm(i),
                },
                menu: <form action={toggleRef.bind(null, i.id)}><Submit className={menuItem}>{i.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>,
              }))}
            />
            <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Μια τιμή δεν σβήνεται, μόνο κρύβεται από τις νέες καταχωρίσεις, ώστε οι υπάρχουσες εγγραφές να μη μένουν με κενό</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
