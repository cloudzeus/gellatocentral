"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentOrg } from "@/lib/auth";
import { checkReceipts } from "@/lib/mydata-receipts";
import { runTask } from "@/lib/tasks";
import { rethrowControlFlow } from "@/lib/workflow-db";

const VIEW = "/transmissions?view=aade";
const back = (q: string): never => { revalidatePath("/transmissions"); redirect(`${VIEW}&${q}`); };

/** «Ξαναέλεγξε τώρα»: ίδιος έλεγχος με τον βραδινό, για την επιχείρηση του χρήστη (mockup mydata-reconcile.html Β). */
export async function recheckReceipts() {
  const { org, user } = await currentOrg("invoices.read");
  try {
    const r = await runTask({ orgId: org.id, userId: user.id, userName: user.name }, { kind: "transmissions.aade-days", title: "Έλεγχος αποδείξεων με την ΑΑΔΕ", permission: "invoices.read" }, async (task) => {
      const result = await checkReceipts(org.id);
      task.result(VIEW);
      return result;
    });
    const msg = r.diff ? `${r.diff} ${r.diff === 1 ? "ημέρα δεν συμφωνεί" : "ημέρες δεν συμφωνούν"} με την ΑΑΔΕ` : "Οι ημέρες που έκλεισαν συμφωνούν ή περιμένουν την ΑΑΔΕ";
    back(`saved=${encodeURIComponent(r.failed.length ? `${msg} · δεν ελέγχθηκαν: ${r.failed.join(", ")}` : msg)}`);
  } catch (e) {
    rethrowControlFlow(e);
    back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Ο έλεγχος απέτυχε")}`);
  }
}
