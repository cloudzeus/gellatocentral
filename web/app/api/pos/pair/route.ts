import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken, ipAllowed } from "@/lib/device-auth";

// Σύζευξη: η συσκευή στέλνει τον κωδικό μίας χρήσης της κονσόλας και παίρνει το μόνιμο κλειδί της (μία φορά).
// shortcut: χωρίς όριο προσπαθειών — ο κωδικός έχει ~40 bit και λήγει σε 15′· όριο ανά διεύθυνση πριν από δημόσια έκθεση.
export async function POST(req: Request) {
  const parsed = z.object({ code: z.string().trim().toUpperCase().length(8), androidId: z.string().regex(/^[0-9a-f]{8,32}$/i).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const device = await db.device.findFirst({
    where: { pairCode: parsed.data.code, pairCodeExpiresAt: { gt: new Date() }, active: true, kind: { not: "POS_WEB" } }, // το ταμείο browser μπαίνει με χρήστη, όχι με κλειδί συσκευής
  });
  if (!device || !ipAllowed(device, req)) return Response.json({ error: "invalid_code" }, { status: 401 });
  const token = randomBytes(32).toString("base64url");
  // η συνθήκη στο pairCode κάνει τον κωδικό πραγματικά μίας χρήσης, ακόμα και σε ταυτόχρονα αιτήματα
  const { count } = await db.device.updateMany({
    where: { id: device.id, pairCode: parsed.data.code },
    data: { apiTokenHash: hashToken(token), pairCode: null, pairCodeExpiresAt: null, pairedAt: new Date(), ...(parsed.data.androidId ? { androidId: parsed.data.androidId.toLowerCase() } : {}) },
  });
  if (count === 0) return Response.json({ error: "invalid_code" }, { status: 401 });
  // η ίδια φυσική συσκευή ήταν πριν άλλο ταμείο της επιχείρησης: η ταυτότητα μεταφέρεται εδώ
  if (parsed.data.androidId) await db.device.updateMany({ where: { orgId: device.orgId, androidId: parsed.data.androidId.toLowerCase(), id: { not: device.id } }, data: { androidId: null } });
  return Response.json({ token, device: device.name });
}
