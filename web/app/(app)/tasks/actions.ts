"use server";

import { revalidatePath } from "next/cache";
import { flashFail } from "@/lib/flash-server";
import { failuresOf } from "@/lib/task-progress";
import { retryable } from "@/lib/task-kinds";
import { findTask, markTasksSeen } from "@/lib/tasks";
import { enrichManufacturers } from "../platform/catalog/actions";

export async function seenTasks() {
  await markTasksSeen();
}

/**
 * «Ξανά»: ξανατρέχει ΜΟΝΟ ό,τι απέτυχε, καλώντας την ίδια ενέργεια που θα πατούσε ο χρήστης (άρα με τους ίδιους
 * ελέγχους δικαιωμάτων και ορίων). Νέα γραμμή στο παράθυρο· η παλιά μένει ως ιστορικό.
 */
const RETRY: Record<string, (ids: string[]) => Promise<void | string>> = {
  "catalog.enrich": (ids) => enrichManufacturers(ids),
};

export async function retryTask(id: string) {
  const found = await findTask(id);
  // μόνο όποιος την ξεκίνησε: το «Ξανά» δεν δίνει σε άλλον ενέργεια που δεν θα μπορούσε να κάνει ο ίδιος
  if (!found || found.row.userId !== found.user.id || !retryable(found.row.kind) || !RETRY[found.row.kind]) return;
  const ids = failuresOf(found.row.failures).flatMap((f) => (f.id ? [f.id] : []));
  if (!ids.length) return;
  const problem = await RETRY[found.row.kind](ids);
  if (problem) await flashFail(`Δεν έγινε: ${problem}`);
  revalidatePath("/tasks");
}
