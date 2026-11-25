import { DataTable } from "@/components/data-table";
import { FormPending } from "@/components/form-pending";
import { Submit } from "@/components/submit";
import { StatusBadge } from "@/components/status-badge";
import { DetailGrid, Badge, btn, Card, Field, menuItem, Page } from "@/components/ui";
import { look } from "@/lib/status";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { activateDocumentTypes, hideDocumentTypes, saveDocumentType, toggleDocumentType } from "../actions";

// Οι τύποι ορίζονται από την ΑΑΔΕ· αλλάζουν μόνο τίτλος, Viva case, σειρά και διαθεσιμότητα.
export default async function DocumentTypesPage({ searchParams }: PageProps<"/platform/document-types">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const list = listParams(q, 50, ["code", "title", "kind", "sign", "receiptCase", "status", "sort"]);
  const status = filterParam(q, "status", ["active", "hidden"]);
  const kind = filterParam(q, "kind", ["retail", "wholesale"]);
  const where = {
    ...(status ? { active: status === "active" } : {}),
    ...(kind ? { retail: kind === "retail" } : {}),
    ...(list.q ? { OR: [{ code: { contains: list.q, mode: "insensitive" as const } }, { title: { contains: list.q, mode: "insensitive" as const } }] } : {}),
  };
  const direction = list.sort ? list.dir : "asc";
  const orderBy = list.sort === "code" ? { code: direction }
    : list.sort === "title" ? { title: direction }
      : list.sort === "kind" ? { retail: direction }
        : list.sort === "sign" ? { sign: direction }
          : list.sort === "receiptCase" ? { receiptCase: direction }
            : list.sort === "status" ? { active: direction }
              : [{ sort: direction }, { code: "asc" as const }];
  const [types, total, active, issuable, counts] = await Promise.all([
    db.documentType.findMany({ where, orderBy, skip: list.skip, take: list.take }),
    db.documentType.count({ where }),
    db.documentType.count({ where: { active: true } }),
    db.documentType.count({ where: { receiptCase: { not: null } } }),
    db.fiscalDocument.groupBy({ by: ["docType"], _count: { _all: true } }),
  ]);
  // Το docType του FiscalDocument είναι κωδικός-κείμενο, όχι σχέση.
  const issueCounts = new Map(counts.map((g) => [g.docType, g._count._all]));

  const typeForm = (t: (typeof types)[number]) => (
    <form key={t.code} action={saveDocumentType} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="typeId" value={t.id} />
      <Field label="Κωδικός myDATA" name="codeShown" defaultValue={t.code} disabled hint="Ορίζεται από την ΑΑΔΕ — δεν αλλάζει" />
      <Field label="Τίτλος" name="title" required maxLength={120} defaultValue={t.title} hint="Ο τίτλος που βλέπει ο χρήστης στις οθόνες και τα παραστατικά" />
      <Field label="ftReceiptCase (Viva)" name="receiptCase" defaultValue={t.receiptCase ?? ""} hint="Δεκαδικός Int64 από τα δείγματα της Viva· κενό = ο τύπος δεν εκδίδεται ακόμη" />
      <Field label="Σειρά εμφάνισης" name="sort" type="number" min={0} max={9999} defaultValue={t.sort} />
      <FormPending label="Αποθήκευση τύπου παραστατικού…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>Αποθήκευση</Submit>
    </form>
  );

  return (
    <Page section="Common Tables" title="Τύποι παραστατικών" description={`${issuable} εκδίδονται · ${active} ενεργοί. Κοινοί τύποι myDATA για ταμείο, τιμολόγηση και χονδρική`}>
      <div className="grid max-w-7xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε{q.error ? `: ${q.error.slice(0, 200)}` : ""}</p> : null}
        <Card>
          <DataTable
            id="document-types"
            bulkActions={[
              { value: "activate", label: "Ενεργοποίηση επιλεγμένων", run: activateDocumentTypes },
              { value: "hide", label: "Απόκρυψη επιλεγμένων", confirm: "Απόκρυψη των επιλεγμένων τύπων παραστατικών;", run: hideDocumentTypes },
            ]}
            listing={{ ...list, total, placeholder: "Κωδικός ή τίτλος…", filters: [
              { key: "kind", label: "Κατηγορία", value: kind, options: [["retail", "Λιανική"], ["wholesale", "Αντικριζόμενο"]] },
              { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["hidden", "Κρυφοί"]] },
            ] }}
            empty="Κανένας τύπος παραστατικού"
            columns={[
              { key: "code", label: "Κωδικός", required: true, sortable: true },
              { key: "title", label: "Τίτλος", sortable: true },
              { key: "kind", label: "Κατηγορία", sortable: true },
              { key: "sign", label: "Πρόσημο", sortable: true },
              { key: "requirements", label: "Απαιτεί" },
              { key: "receiptCase", label: "ftReceiptCase", sortable: true },
              { key: "issues", label: "Εκδόσεις", numeric: true },
              { key: "status", label: "Κατάσταση", sortable: true },
            ]}
            rows={types.map((t) => ({
              id: t.id,
              cells: {
                code: <span className="font-mono text-xs">{t.code}</span>,
                title: <span className="font-semibold">{t.title}</span>,
                kind: t.retail ? <Badge>Λιανική</Badge> : <Badge tone="warning">Αντικριζόμενο</Badge>,
                sign: t.sign === 1 ? "Χρέωση" : "Πίστωση",
                requirements: <span className="text-xs">{[t.needsParty ? "ΑΦΜ λήπτη" : null, t.needsRelated ? "Συσχέτιση" : null].filter(Boolean).join(" · ") || "—"}</span>,
                receiptCase: <span className="font-mono text-xs">{t.receiptCase ?? "δεν εκδίδεται"}</span>,
                issues: issueCounts.get(t.code) || "—",
                status: t.active ? <StatusBadge look={look("success", "Ενεργός")} /> : <StatusBadge look={look("neutral", "Κρυφός")} />,
              },
              details: {
                label: `${t.code} · ${t.title}`,
                view: <DetailGrid className="sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Φορολογικό πρόσημο</dt><dd className="font-medium">{t.sign === 1 ? "Χρέωση" : "Πίστωση"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Απαιτήσεις</dt><dd className="font-medium">{[t.needsParty ? "ΑΦΜ λήπτη" : null, t.needsRelated ? "Συσχέτιση" : null].filter(Boolean).join(" · ") || "Καμία"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Εκδόσεις</dt><dd className="font-medium tabular-nums">{issueCounts.get(t.code) ?? 0}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Σειρά</dt><dd className="font-medium tabular-nums">{t.sort}</dd></div>
                </DetailGrid>,
                edit: typeForm(t),
              },
              menu: <form action={toggleDocumentType.bind(null, t.id)}><Submit className={menuItem}>{t.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>,
            }))}
          />
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Οι φορολογικοί κανόνες ορίζονται από την ΑΑΔΕ. Τύπος χωρίς επαληθευμένο ftReceiptCase δεν εκδίδεται</p>
        </Card>
      </div>
    </Page>
  );
}
