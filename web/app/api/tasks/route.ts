import { listTasks } from "@/lib/tasks";
import { retryable } from "@/lib/task-kinds";

// Το παράθυρο «Εργασίες» ρωτά εδώ κάθε ~2 δευτ. μόνο όσο κάτι τρέχει. Ο χρήστης βλέπει ό,τι επιτρέπει ο ρόλος του.
export async function GET() {
  const list = await listTasks(retryable);
  if (!list) return Response.json({ code: "UNAUTHORIZED", message: "Χρειάζεται σύνδεση" }, { status: 401 });
  return Response.json(list, { headers: { "Cache-Control": "no-store" } });
}
