"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { flashFail, flashOk } from "@/lib/flash-server";
import { KIND_ORDER, planProblems, SPACE_ORDER, type StoreKind } from "@/lib/store-setup";
import { createStoreFromPlan } from "@/lib/store-setup-db";
import { checkTerminal } from "@/lib/viva/terminal-check";

const count = z.coerce.number().int().min(0).max(60);
const plan = z.object({
  spaces: z.object(Object.fromEntries(SPACE_ORDER.map((k) => [k, count])) as Record<(typeof SPACE_ORDER)[number], typeof count>),
  tills: count, handhelds: count, receiptPrinters: count, orderPrinters: count,
  zones: z.array(z.object({ name: z.string().trim().max(30), prefix: z.string().trim().max(3), count, seats: count })).max(20),
});
const input = z.object({
  name: z.string().trim().min(2).max(60),
  address: z.string().trim().max(120).transform((v) => v || null),
  legalEntityId: z.string().transform((v) => v || null),
  kind: z.enum(KIND_ORDER as [StoreKind, ...StoreKind[]]),
  plan: z.string().transform((v, ctx) => { try { return JSON.parse(v); } catch { ctx.addIssue({ code: "custom" }); return z.NEVER; } }).pipe(plan),
});

export async function createStore(form: FormData) {
  const { org } = await currentOrg("devices.add");
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) { await flashFail("Δεν φτιάχτηκε: έλεγξε το όνομα του σημείου"); return; }
  const d = parsed.data;
  const problems = planProblems(d.plan);
  if (problems.length) { await flashFail("Δεν φτιάχτηκε το σημείο", problems.join(". ")); return; }
  if (d.legalEntityId && !(await db.legalEntity.findFirst({ where: { id: d.legalEntityId, orgId: org.id, active: true } }))) { await flashFail("Δεν φτιάχτηκε: ο εκδότης δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  const store = await createStoreFromPlan(org.id, d);
  revalidatePath("/devices");
  revalidatePath("/billing");
  await flashOk(`Το σημείο «${store.name}» φτιάχτηκε`);
  redirect(`/devices/setup/${store.id}`);
}

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ίδιο με την πλατφόρμα: χωρίς 0/O/1/I

/** Νέος κωδικός σύνδεσης (15′) για ταμείο Android. Ο ιδιοκτήτης τον βλέπει ως QR στη σελίδα ετοιμότητας. */
export async function issuePairQr(storeId: string, deviceId: string) {
  const { org } = await currentOrg("devices.edit");
  const pairCode = Array.from({ length: 8 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join("");
  await db.device.updateMany({ where: { id: deviceId, orgId: org.id, storeId, kind: "POS_ANDROID" }, data: { pairCode, pairCodeExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  revalidatePath(`/devices/setup/${storeId}`);
}

export async function setTerminal(storeId: string, deviceId: string, form: FormData) {
  const { org } = await currentOrg("devices.edit");
  const terminalId = String(form.get("vivaTerminalId") ?? "").trim();
  if (!/^\d{4,20}$/.test(terminalId)) { await flashFail("Δεν αποθηκεύτηκε: το Terminal ID είναι αριθμός", "Το βλέπεις στην οθόνη του Viva POS, στις ρυθμίσεις."); return; }
  const problem = await checkTerminal({ terminalId, orgId: org.id, storeId, deviceId });
  if (problem) { await flashFail(`Δεν αποθηκεύτηκε: ${problem}`, "Γράψε το σωστό Terminal ID και δοκίμασε ξανά."); return; }
  await db.device.updateMany({ where: { id: deviceId, orgId: org.id, storeId }, data: { vivaTerminalId: terminalId, vivaCloud: form.get("vivaCloud") === "1" } });
  revalidatePath(`/devices/setup/${storeId}`);
  await flashOk(`Το τερματικό ${terminalId} αποθηκεύτηκε`);
}

const printer = z.object({
  connection: z.enum(["NETWORK", "BLUETOOTH", "USB"]),
  address: z.string().trim().max(40).transform((v) => v || null),
}).refine((v) => v.connection === "USB" || (v.connection === "NETWORK" ? /^[\w.-]+(:\d{2,5})?$/ : /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/).test(v.address ?? ""));

export async function setPrinter(storeId: string, printerId: string, form: FormData) {
  const { org } = await currentOrg("devices.edit");
  const parsed = printer.safeParse(Object.fromEntries(form));
  if (!parsed.success) { await flashFail("Δεν αποθηκεύτηκε: η διεύθυνση δεν ταιριάζει με τη σύνδεση", "Δίκτυο: π.χ. 192.168.1.40:9100. Bluetooth: π.χ. AA:BB:CC:DD:EE:FF."); return; }
  await db.printer.updateMany({ where: { id: printerId, orgId: org.id, storeId }, data: { ...parsed.data, address: parsed.data.connection === "USB" ? null : parsed.data.address } });
  revalidatePath(`/devices/setup/${storeId}`);
  await flashOk("Ο εκτυπωτής αποθηκεύτηκε");
}
