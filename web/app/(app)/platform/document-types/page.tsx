import { Pencil } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveDocumentType, toggleDocumentType } from "../actions";

// Οι τύποι παραστατικών myDATA: τους ορίζει η ΑΑΔΕ, οπότε δεν προστίθενται νέοι από εδώ —
// διαχειριζόμαστε ποιοι είναι διαθέσιμοι και τον κωδικό της Viva (ftReceiptCase) του καθενός.
export default async function DocumentTypesPage({ searchParams }: PageProps<"/platform/document-types">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const types = await db.documentType.findMany({ orderBy: [{ sort: "asc" }, { code: "asc" }] });
  // εκδόσεις ανά τύπο (το docType του FiscalDocument είναι κωδικός-κείμενο, όχι σχέση)
  const counts = new Map((await db.fiscalDocument.groupBy({ by: ["docType"], _count: { _all: true } })).map((g) => [g.docType, g._count._all]));

  const typeForm = (t: (typeof types)[number]) => (
    <form key={t.code} action={saveDocumentType} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="typeId" value={t.id} />
      <Field label="Κωδικός myDATA" name="codeShown" defaultValue={t.code} disabled hint="Ορίζεται από την ΑΑΔΕ — δεν αλλάζει" />
      <Field label="Τίτλος" name="title" required maxLength={120} defaultValue={t.title} hint="Ο τίτλος που βλέπει ο χρήστης στις οθόνες και τα παραστατικά" />
      <Field label="ftReceiptCase (Viva)" name="receiptCase" defaultValue={t.receiptCase ?? ""} hint="Δεκαδικός Int64 από τα δείγματα της Viva· κενό = ο τύπος δεν εκδίδεται ακόμη" />
      <Field label="Σειρά εμφάνισης" name="sort" type="number" min={0} max={9999} defaultValue={t.sort} />
      <Submit className={btn("default")}>Αποθήκευση</Submit>
    </form>
  );

  return (
    <Page section="Common Tables" title="Τύποι παραστατικών" description="Οι τύποι myDATA που γνωρίζει η εφαρμογή — κοινοί για ταμείο, τιμολόγηση και χονδρική">
      <div className="grid max-w-6xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε{q.error ? `: ${q.error.slice(0, 200)}` : ""}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι τύποι παραστατικών ενημερώθηκαν</p> : null}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">Τύποι</h2>
              <p className="text-sm text-muted-foreground">{types.filter((t) => t.receiptCase !== null).length} εκδίδονται · {types.filter((t) => t.active).length} ενεργοί από {types.length}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-semibold">Κωδικός</th><th className="px-3 py-2 font-semibold">Τίτλος</th><th className="px-3 py-2 font-semibold">Κατηγορία</th>
                  <th className="px-3 py-2 font-semibold">Πρόσημο</th><th className="px-3 py-2 font-semibold">Απαιτεί</th><th className="px-3 py-2 font-semibold">ftReceiptCase</th>
                  <th className="px-3 py-2 text-right font-semibold">Εκδόσεις</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.id} className={cn("border-t border-border/70", t.active ? "" : "text-muted-foreground")}>
                    <td className="px-5 py-2 font-mono text-xs">{t.code}</td>
                    <td className="px-3 py-2 font-medium">{t.title}</td>
                    <td className="px-3 py-2">{t.retail ? <Badge>Λιανική</Badge> : <Badge tone="warning">Αντικριζόμενο</Badge>}</td>
                    <td className="px-3 py-2">{t.sign === 1 ? "Χρέωση" : "Πίστωση"}</td>
                    <td className="px-3 py-2 text-xs">{[t.needsParty ? "ΑΦΜ λήπτη" : null, t.needsRelated ? "Συσχέτιση" : null].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.receiptCase ?? <span className="text-muted-foreground">δεν εκδίδεται</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{counts.get(t.code) || "—"}</td>
                    <td className="px-3 py-2">{t.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>}</td>
                    <td className="px-5 py-1.5">
                      <span className="flex justify-end gap-1">
                        <Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={`${t.code} · ${t.title}`}>{typeForm(t)}</Modal>
                        <form action={toggleDocumentType.bind(null, t.id)}><Submit className={btn("ghost", "sm")}>{t.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">
            Οι φορολογικοί κανόνες (πρόσημο, ανάγκη ΑΦΜ ή συσχέτισης) ορίζονται από την ΑΑΔΕ και αλλάζουν μόνο με έκδοση της εφαρμογής.
            Τύπος χωρίς ftReceiptCase δεν εκδίδεται: χρειάζεται πρώτα επαληθευμένο δείγμα από το demo της Viva.
          </p>
        </Card>
      </div>
    </Page>
  );
}
