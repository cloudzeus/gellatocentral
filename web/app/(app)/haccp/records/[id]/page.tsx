import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { btn, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateHaccpRecord } from "../../actions";
import { HaccpRecordForm } from "../../record-form";

const localInput = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(" ", "T");
export default async function HaccpRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, q, ctx] = await Promise.all([params, searchParams, currentOrg("haccp.read")]);
  const record = await db.haccpRecord.findFirst({ where: { id, orgId: ctx.org.id, ...(ctx.storeIds.length ? { storeId: { in: ctx.storeIds } } : {}) }, include: { store: { select: { name: true } } } });
  if (!record) notFound();
  const stores = await db.store.findMany({ where: { orgId: ctx.org.id, active: true, ...(ctx.storeIds.length ? { id: { in: ctx.storeIds } } : {}) }, select: { id: true, name: true } });
  return <Page section="HACCP" title="Καταχώριση τεκμηρίωσης" description={`${record.store?.name ?? "Όλη η επιχείρηση"} · δημιουργήθηκε από ${record.createdByName}`} actions={<><Link href={`/haccp/forms/${record.templateId}`} className={btn("outline", "sm")}><Printer /> Έντυπο</Link><Link href="/haccp?view=records" className={btn("outline", "sm")}><ArrowLeft /> Καταχωρίσεις</Link></>}>
    <div className="grid max-w-5xl gap-4">
      {q.saved ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">Η καταχώριση αποθηκεύτηκε.</p> : null}
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{q.error}</p> : null}
      {ctx.can("haccp.edit") ? <HaccpRecordForm action={updateHaccpRecord.bind(null, id)} stores={stores} value={{ ...record, occurredAt: localInput(record.occurredAt) }} /> : <p>Δεν έχεις δικαίωμα επεξεργασίας.</p>}
    </div>
  </Page>;
}
