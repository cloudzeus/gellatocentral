import { Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { SetupWizard } from "./wizard";

export default async function StoreSetupPage() {
  const { org } = await currentOrg("devices.add");
  const entities = await db.legalEntity.findMany({ where: { orgId: org.id, active: true }, orderBy: { name: "asc" } });
  const own = await db.organization.findUniqueOrThrow({ where: { id: org.id }, select: { name: true, legalName: true, vatNumber: true } });
  const issuers = [{ id: "", label: `Η επιχείρηση · ${own.legalName || own.name} · ΑΦΜ ${own.vatNumber}` }, ...entities.map((e) => ({ id: e.id, label: `${e.name} · ΑΦΜ ${e.vatNumber}` }))];
  return (
    <Page section="Ταμείο & τιμολόγηση" title="Στήσιμο σημείου" description="Τρία βήματα: τι σημείο είναι, τι εξοπλισμό έχει, τι λείπει για να ανοίξει">
      <div className="max-w-7xl"><SetupWizard issuers={issuers} /></div>
    </Page>
  );
}
