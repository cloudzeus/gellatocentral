import { z } from "zod";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { tablePreferencesSchema } from "@/lib/table-preferences";

const tableId = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = tableId.safeParse(new URL(req.url).searchParams.get("table"));
  if (!parsed.success) return Response.json({ error: "invalid_table" }, { status: 400 });
  const saved = await db.userTablePreference.findUnique({ where: { userId_tableId: { userId: user.id, tableId: parsed.data } } });
  const prefs = saved ? tablePreferencesSchema.safeParse(saved.prefs) : null;
  return Response.json({ prefs: prefs?.success ? prefs.data : null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ tableId, prefs: tablePreferencesSchema }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_preferences" }, { status: 400 });
  const { tableId: id, prefs } = parsed.data;
  await db.userTablePreference.upsert({
    where: { userId_tableId: { userId: user.id, tableId: id } },
    create: { userId: user.id, tableId: id, prefs },
    update: { prefs },
  });
  return Response.json({ ok: true });
}
