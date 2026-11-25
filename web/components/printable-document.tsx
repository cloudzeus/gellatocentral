import type { ReactNode } from "react";
import { PrintDocumentButton } from "./print-document-button";
import { DocumentPdfButton } from "./document-output";

export function PrintableDocument({ org, title, subtitle, entityType, entityId, children }: { org: { name: string; legalName: string | null; vatNumber: string; labelExtraText: string | null }; title: string; subtitle?: string; entityType: "production_batch" | "recipe"; entityId: string; children: ReactNode }) {
  return <main className="mx-auto max-w-4xl bg-background p-6 text-foreground print:max-w-none print:bg-white print:p-0 print:text-black">
    <div className="mb-5 flex items-start justify-between gap-4 border-b border-border pb-4 print:border-black">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-black">{org.legalName || org.name} · ΑΦΜ {org.vatNumber}</p><h1 className="mt-1 text-2xl font-bold">{title}</h1>{subtitle ? <p className="mt-1 text-sm text-muted-foreground print:text-black">{subtitle}</p> : null}</div>
      <div className="flex flex-wrap justify-end gap-2 print:hidden"><DocumentPdfButton entityType={entityType} entityId={entityId} /><PrintDocumentButton entityType={entityType} entityId={entityId} /></div>
    </div>
    <div className="grid gap-5 text-sm [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left print:[&_td]:border-black print:[&_th]:border-black">{children}</div>
    {org.labelExtraText ? <p className="mt-6 border-t border-border pt-3 text-xs print:border-black">{org.labelExtraText}</p> : null}
    <p className="mt-3 text-xs text-muted-foreground print:text-black">Gelato System · το κουμπί PDF δημιουργεί και αποθηκεύει ιδιωτικό αρχείο· η εκτύπωση browser παραμένει ξεχωριστή ενέργεια.</p>
  </main>;
}
