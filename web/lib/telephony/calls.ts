// Κλήσεις από το τηλεφωνικό κέντρο → καταγραφή, ποιο ταμείο ειδοποιείται, ποιος πελάτης είναι.
import { db } from "../db";
import { partiesByPhone } from "../orders";
import { normalizePhone } from "../reservation";
import type { CallEvent } from "./yeastar";

/** Ένα γεγονός κλήσης για την επιχείρηση. Το ίδιο call_id έρχεται σε κάθε αλλαγή: μία γραμμή ανά κλήση. */
export async function recordCallEvent(orgId: string, ev: CallEvent, now = new Date()) {
  if (ev.kind === "ring") {
    const phone = normalizePhone(ev.from);
    const [partyId] = await partiesByPhone(orgId, phone);
    const device = ev.extension ? await db.device.findFirst({ where: { orgId, pbxExtension: ev.extension, active: true }, select: { id: true } }) : null;
    await db.call.upsert({
      where: { orgId_callId: { orgId, callId: ev.callId } },
      create: { orgId, callId: ev.callId, phone, extension: ev.extension, deviceId: device?.id, partyId, startedAt: now },
      // ξανά «χτυπά» σε άλλο εσωτερικό (ουρά/προώθηση): το ταμείο ακολουθεί
      update: device ? { deviceId: device.id, extension: ev.extension } : {},
    });
    if (partyId) {
      await db.partyActivity.upsert({
        where: { source_externalId: { source: "telephony", externalId: ev.callId } },
        create: { orgId, partyId, kind: "call", direction: "in", subject: "Εισερχόμενη κλήση", userName: "Τηλεφωνικό κέντρο", source: "telephony", externalId: ev.callId, at: now },
        update: {},
      });
    }
    return;
  }
  const call = await db.call.findUnique({ where: { orgId_callId: { orgId, callId: ev.callId } }, select: { id: true, state: true } });
  if (!call) return;
  if (ev.kind === "answered" && call.state === "RINGING") await db.call.update({ where: { id: call.id }, data: { state: "ANSWERED", answeredAt: now } });
  if (ev.kind === "ended" && (call.state === "RINGING" || call.state === "ANSWERED"))
    await db.call.update({ where: { id: call.id }, data: { state: call.state === "RINGING" ? "MISSED" : "ENDED", endedAt: now } });
}

/**
 * Η κλήση που πρέπει να δείξει τώρα αυτό το ταμείο: χτυπά ή μόλις απαντήθηκε, δεν την έκλεισε, των τελευταίων 3′.
 * Κλήση χωρίς εσωτερικό που να αντιστοιχεί σε ταμείο φαίνεται σε όλα τα ταμεία της επιχείρησης.
 */
export async function liveCall(ctx: { org: { id: string }; device: { id: string } }, now = new Date()) {
  return db.call.findFirst({
    where: { orgId: ctx.org.id, state: { in: ["RINGING", "ANSWERED"] }, seenAt: null, startedAt: { gte: new Date(now.getTime() - 180_000) }, OR: [{ deviceId: ctx.device.id }, { deviceId: null }] },
    orderBy: { startedAt: "desc" },
    select: { id: true, phone: true, state: true, startedAt: true, extension: true },
  });
}
