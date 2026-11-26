import { tillFromRequest } from "@/lib/device-auth";
import { dayTransactions } from "@/lib/pos-transactions";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });

// Οθόνη «Συναλλαγές» του ταμείου: αποδείξεις, πιστωτικά και μερίδια της ημέρας (?date=YYYY-MM-DD, προεπιλογή σήμερα).
export async function GET(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const date = new URL(req.url).searchParams.get("date") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "invalid" }, { status: 400 });
  return Response.json({ date, rows: await dayTransactions(ctx, date) });
}
