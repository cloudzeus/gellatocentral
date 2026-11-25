"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acknowledgeSchedule } from "@/lib/staff-db";
import { workflowMessage } from "@/lib/workflow-db";

export async function acknowledge(form: FormData) {
  const token = String(form.get("token") ?? "");
  const path = `/schedule/${encodeURIComponent(token)}`;
  try { await acknowledgeSchedule(token, Number(form.get("version"))); revalidatePath(path); redirect(`${path}?saved=1`); }
  catch (error) { redirect(`${path}?error=${encodeURIComponent(workflowMessage(error))}`); }
}
