"use server";
import { flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/auth";
import { assessAllTenants } from "@/lib/haccp/assessment-db";
import { checkOfficialSources } from "@/lib/haccp/source-check";
import { db } from "@/lib/db";
import { HACCP_SOURCES } from "@/lib/haccp/sources";
import { runTask } from "@/lib/tasks";

export async function assessAllHaccpTenants() {
  const user = await requirePlatform("orgs.read");
  const total = await db.organization.count();
  await runTask({ orgId: null, userId: user.id, userName: user.name }, { kind: "haccp.assess", title: "Αξιολόγηση HACCP όλων των συνδρομητών", permission: "orgs.read", total }, async (task) => {
    await assessAllTenants(new Date(), task);
    task.result("/platform/haccp");
  });
  revalidatePath("/platform/haccp");
  await flashOk("Η αξιολόγηση HACCP όλων των συνδρομητών ολοκληρώθηκε");
}
export async function refreshHaccpSources() {
  const user = await requirePlatform("orgs.read");
  await runTask({ orgId: null, userId: user.id, userName: user.name }, { kind: "haccp.sources", title: "Έλεγχος επίσημων πηγών HACCP", permission: "orgs.read", total: HACCP_SOURCES.length }, async (task) => {
    await checkOfficialSources(new Date(), task);
    task.result("/platform/haccp");
  });
  revalidatePath("/platform/haccp");
  await flashOk("Ο έλεγχος των επίσημων πηγών HACCP ολοκληρώθηκε");
}
