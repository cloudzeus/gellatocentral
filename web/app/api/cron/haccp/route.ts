// Περιοδικά snapshots και έλεγχος επίσημων πηγών· καμία αυτόματη αναδιατύπωση νομικού περιεχομένου.
import { timingSafeEqual } from "node:crypto";
import { setting } from "@/lib/config";
import { assessAllTenants } from "@/lib/haccp/assessment-db";
import { checkOfficialSources } from "@/lib/haccp/source-check";

export async function POST(req: Request) {
  const secret = await setting("CRON_SECRET");
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 20 || Buffer.byteLength(given) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const task = new URL(req.url).searchParams.get("task") ?? "all";
  if (!["all", "sources", "assessments"].includes(task)) return Response.json({ error: "invalid task" }, { status: 400 });
  const result: { sources?: unknown; assessments?: unknown } = {};
  if (task === "all" || task === "sources") result.sources = await checkOfficialSources();
  if (task === "all" || task === "assessments") result.assessments = await assessAllTenants();
  return Response.json(result);
}
