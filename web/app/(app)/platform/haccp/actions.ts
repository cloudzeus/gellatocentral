"use server";
import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/auth";
import { assessAllTenants } from "@/lib/haccp/assessment-db";
import { checkOfficialSources } from "@/lib/haccp/source-check";

export async function assessAllHaccpTenants() {
  await requirePlatform("orgs.read");
  await assessAllTenants();
  revalidatePath("/platform/haccp");
}
export async function refreshHaccpSources() {
  await requirePlatform("orgs.read");
  await checkOfficialSources();
  revalidatePath("/platform/haccp");
}
