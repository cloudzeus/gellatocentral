import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { btn, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentAthensInput } from "@/lib/haccp/time";
import { createHaccpRecord } from "../../actions";
import { HaccpRecordForm } from "../../record-form";

export default async function NewHaccpRecord({ searchParams }: PageProps<"/haccp/records/new">) {
  const [{ org, user, storeIds }, q] = await Promise.all([currentOrg("haccp.add"), searchParams]);
  const stores = await db.store.findMany({ where: { orgId: org.id, active: true, ...(storeIds.length ? { id: { in: storeIds } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const templateId = typeof q.template === "string" && q.template ? q.template : "cold-storage";
  const local = currentAthensInput();
  return <Page section="HACCP" title="Νέα καταχώριση" description="Πραγματικό γεγονός, μέτρηση ή τεκμηριωμένος έλεγχος" actions={<Link href="/haccp" className={btn("outline", "sm")}><ArrowLeft /> HACCP</Link>}>
    <div className="grid max-w-5xl gap-4">
      {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{q.error}</p> : null}
      <HaccpRecordForm action={createHaccpRecord} stores={stores} value={{ templateId, storeId: stores.length === 1 ? stores[0]!.id : null, occurredAt: local, status: "COMPLETED", result: "CONFORMING", measuredValue: null, unit: null, responsibleName: user.name, notes: null, correctiveAction: null }} />
    </div>
  </Page>;
}
