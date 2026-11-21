import { Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, cn, Field, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveVatRate, toggleVatRate } from "../actions";

// Οι κοινοί συντελεστές ΦΠΑ από τους οποίους διαλέγουν όλα τα προϊόντα και οι υπηρεσίες. Τους ορίζει η πλατφόρμα.
export default async function VatRatesPage({ searchParams }: PageProps<"/platform/vat-rates">) {
  await requirePlatform("settings.read");
  const q = await searchParams;
  const rates = await db.vatRate.findMany({ orderBy: [{ rate: "desc" }], include: { _count: { select: { products: true } } } });
  const rateForm = (r?: (typeof rates)[number]) => {
    const locked = (r?._count.products ?? 0) > 0;
    return (
      <form key={r ? `${r.name}-${r.rate}` : "new"} action={saveVatRate} className="grid gap-4 [&>button]:justify-self-end">
        <input type="hidden" name="rateId" value={r?.id ?? ""} />
        <Field label="Όνομα" name="name" required maxLength={40} defaultValue={r?.name} hint="π.χ. Κανονικός, Μειωμένος, Απαλλαγή" />
        {/* ποσοστό που το χρησιμοποιούν προϊόντα κλειδώνει: αλλαγή του θα άλλαζε σιωπηρά τον ΦΠΑ τους */}
        {locked ? <input type="hidden" name="rate" value={r!.rate} /> : null}
        <Field label="Ποσοστό %" name={locked ? "rateShown" : "rate"} type="number" required min={0} max={99} step={1} defaultValue={r?.rate ?? ""} disabled={locked} hint={locked ? `Δεν αλλάζει: τον χρησιμοποιούν ήδη ${r!._count.products} προϊόντα` : "Ολόκληρο ποσοστό, π.χ. 24"} />
        <Submit className={btn("default")}>{r ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      </form>
    );
  };

  return (
    <Page section="Common Tables" title="Συντελεστές ΦΠΑ" description="Κοινοί για όλους τους συνδρομητές. Τα προϊόντα και οι υπηρεσίες διαλέγουν έναν από αυτούς">
      <div className="grid max-w-5xl gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">Οι συντελεστές ενημερώθηκαν</p> : null}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
            <div className="min-w-0 flex-1"><h2 className="text-lg">Συντελεστές</h2><p className="text-sm text-muted-foreground">{rates.length ? `${rates.filter((r) => r.active).length} ενεργοί από ${rates.length}` : "Κανένας συντελεστής ακόμα"}</p></div>
            <Modal label={<><Plus /> Νέος συντελεστής</>} size="sm" title="Νέος συντελεστής ΦΠΑ">{rateForm()}</Modal>
          </div>
          {rates.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-semibold">Όνομα</th><th className="px-3 py-2 text-right font-semibold">Ποσοστό</th><th className="px-3 py-2 text-right font-semibold">Προϊόντα</th><th className="px-3 py-2 font-semibold">Κατάσταση</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className={cn("border-t border-border/70", r.active ? "" : "text-muted-foreground")}>
                      <td className="px-5 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.rate}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r._count.products || "—"}</td>
                      <td className="px-3 py-2">{r.active ? <Badge tone="success">Ενεργός</Badge> : <Badge>Κρυφός</Badge>}</td>
                      <td className="px-5 py-1.5"><span className="flex justify-end gap-1"><Modal label={<><Pencil /> Αλλαγή</>} size="sm" title={`${r.name} ${r.rate}%`}>{rateForm(r)}</Modal><form action={toggleVatRate.bind(null, r.id)}><Submit className={btn("ghost", "sm")}>{r.active ? "Απόκρυψη" : "Εμφάνιση"}</Submit></form></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">Κανένας συντελεστής ακόμα. Πρόσθεσε τον πρώτο με το «Νέος συντελεστής»</p>}
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground">Ένας συντελεστής δεν σβήνεται, μόνο κρύβεται από τις νέες καταχωρίσεις: έτσι τα προϊόντα που τον έχουν ήδη δεν μένουν με κενό. Το ποσοστό συντελεστή που χρησιμοποιείται σε προϊόντα δεν αλλάζει</p>
        </Card>
      </div>
    </Page>
  );
}
