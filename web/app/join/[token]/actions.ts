"use server";

import { redirect } from "next/navigation";
import { startSession } from "@/lib/auth";
import { acceptEmployeeInvite } from "@/lib/staff-db";
import { WorkflowError } from "@/lib/workflow-db";

export async function join(token: string, form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("password2") ?? "")) redirect(`/join/${token}?error=${encodeURIComponent("Οι δύο κωδικοί δεν ταιριάζουν")}`);
  let userId: string;
  try {
    userId = (await acceptEmployeeInvite(token, { email: String(form.get("email") ?? ""), password, phone: String(form.get("phone") ?? "") || null })).id;
  } catch (error) {
    if (error instanceof WorkflowError) redirect(`/join/${token}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  await startSession(userId);
  redirect("/me?welcome=1");
}
