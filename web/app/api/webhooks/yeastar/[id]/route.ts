import { db } from "@/lib/db";
import { recordCallEvent } from "@/lib/telephony/calls";
import { parseEvent, verifySignature } from "@/lib/telephony/yeastar";

// Webhook του Yeastar P-Series (γεγονότα 30011/30012). Η διεύθυνση έχει το id της σύνδεσης· η υπογραφή ελέγχεται
// με το δικό της μυστικό ΠΡΙΝ διαβαστεί το σώμα. Απαντά γρήγορα: μόνο καταγραφή.
export async function POST(req: Request, { params }: RouteContext<"/api/webhooks/yeastar/[id]">) {
  const raw = await req.text();
  const integration = await db.integration.findUnique({ where: { id: (await params).id }, select: { id: true, orgId: true, kind: true, enabled: true, webhookSecret: true } });
  if (!integration || integration.kind !== "YEASTAR" || !integration.enabled) return new Response("not found", { status: 404 });
  if (!verifySignature(raw, integration.webhookSecret, req.headers.get("x-signature"))) return new Response("bad signature", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const ev = parseEvent(body);
  await db.integration.update({ where: { id: integration.id }, data: { lastEventAt: new Date() } });
  if (ev) await recordCallEvent(integration.orgId, ev);
  return new Response("ok");
}
