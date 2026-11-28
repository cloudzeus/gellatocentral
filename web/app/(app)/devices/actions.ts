"use server";

import { flashFail, flashOk } from "@/lib/flash-server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEVICE_KIND } from "@/lib/devices";
import { attachWarehouse } from "@/lib/warehouses";
import { currentOrg } from "@/lib/auth";
import { checkTerminal } from "@/lib/viva/terminal-check";

const temperature = z.string().trim().max(8).default("").transform((v) => (v === "" ? null : Number(v.replace(",", ".")))).refine((v) => v === null || (Number.isFinite(v) && Math.abs(v) <= 100));
const input = z
  .object({
    name: z.string().trim().min(2).max(40),
    storeId: z.string().cuid(),
    kind: z.enum(Object.keys(DEVICE_KIND) as [keyof typeof DEVICE_KIND, ...(keyof typeof DEVICE_KIND)[]]),
    series: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,6}$/),
    vivaTerminalId: z.string().trim().max(20).optional(),
    tempMin: temperature,
    tempMax: temperature,
  })
  // ταμείο = υποχρεωτική σειρά· ό,τι δεν ταιριάζει στο είδος μηδενίζεται, ό,τι κι αν έστειλε η φόρμα
  .refine((v) => !DEVICE_KIND[v.kind].invoices || v.series.length > 0)
  .refine((v) => v.tempMin === null || v.tempMax === null || v.tempMin < v.tempMax)
  .transform((v) => {
    const k = DEVICE_KIND[v.kind];
    return { ...v, series: k.invoices ? v.series : null, vivaTerminalId: k.invoices ? v.vivaTerminalId || null : null, tempMin: k.storage ? v.tempMin : null, tempMax: k.storage ? v.tempMax : null };
  });

export async function addDevice(form: FormData) {
  const { org } = await currentOrg("devices.add");
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) { await flashFail("Δεν αποθηκεύτηκε: έλεγξε τα πεδία της συσκευής"); return; } // η φόρμα έχει ήδη ελέγξει τα πεδία· εδώ φτάνει μόνο πειραγμένο αίτημα ή ελλιπές ταμείο
  const data = parsed.data;
  // το κατάστημα πρέπει να ανήκει στην επιχείρηση· η σειρά είναι μοναδική ανά επιχείρηση
  if (!(await db.store.findFirst({ where: { id: data.storeId, orgId: org.id } }))) { await flashFail("Δεν αποθηκεύτηκε: το κατάστημα δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  if (data.series && (await db.device.findFirst({ where: { orgId: org.id, series: data.series } }))) { await flashFail(`Δεν αποθηκεύτηκε: η σειρά ${data.series} χρησιμοποιείται ήδη από άλλο ταμείο`, "Γράψε άλλη σειρά και δοκίμασε ξανά."); return; }
  const terminal = await checkTerminal({ terminalId: data.vivaTerminalId, orgId: org.id, storeId: data.storeId });
  if (terminal) { await flashFail(`Δεν αποθηκεύτηκε: ${terminal}`, "Γράψε το σωστό Terminal ID και δοκίμασε ξανά."); return; }
  await db.$transaction(async (tx) => {
    // ψυγείο και αυτόματος πωλητής είναι και αποθηκευτικοί χώροι: δένονται αμέσως στο κατάστημα της συσκευής
    // (η attachWarehouse κάνει προεπιλογή μόνο αν το κατάστημα δεν έχει ήδη)
    const warehouse = DEVICE_KIND[data.kind].storage ? await tx.warehouse.create({ data: { orgId: org.id, name: data.name } }) : null;
    if (warehouse) await attachWarehouse(tx, { orgId: org.id, storeId: data.storeId, warehouseId: warehouse.id });
    await tx.device.create({ data: { ...data, orgId: org.id, warehouseId: warehouse?.id } });
  });
  revalidatePath("/devices");
  revalidatePath("/billing");
  await flashOk(`Η συσκευή «${data.name}» αποθηκεύτηκε`);
}

export async function toggleDevice(deviceId: string) {
  const { org } = await currentOrg("devices.edit");
  const device = await db.device.findFirst({ where: { id: deviceId, orgId: org.id } });
  // ενεργοποίηση: το τερματικό του μπορεί στο μεταξύ να μπήκε σε άλλο ταμείο
  const terminal = device && !device.active ? await checkTerminal({ terminalId: device.vivaTerminalId, orgId: org.id, storeId: device.storeId, deviceId: device.id }) : null;
  if (terminal) { await flashFail(`Δεν ενεργοποιήθηκε: ${terminal}`, "Άλλαξε το τερματικό της συσκευής και δοκίμασε ξανά."); return; }
  if (device) await db.device.update({ where: { id: device.id }, data: { active: !device.active } });
  revalidatePath("/devices");
  revalidatePath("/billing");
  if (device) await flashOk(`Η συσκευή «${device.name}» ${device.active ? "απενεργοποιήθηκε" : "ενεργοποιήθηκε"}`);
  else await flashFail("Δεν έγινε: η συσκευή δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά.");
}

/** Μεταφορά ταμείου σε άλλο κατάστημα (η συσκευή άλλαξε μαγαζί). Κρατά σειρά και Android ID· η αποθήκη ξαναδιαλέγεται. */
export async function moveDevice(deviceId: string, form: FormData) {
  const { org } = await currentOrg("devices.edit");
  const storeId = String(form.get("storeId") ?? "");
  const [device, store] = await Promise.all([
    db.device.findFirst({ where: { id: deviceId, orgId: org.id } }),
    db.store.findFirst({ where: { id: storeId, orgId: org.id, active: true }, select: { id: true, name: true } }),
  ]);
  if (!device || !store || !DEVICE_KIND[device.kind].invoices) { await flashFail("Δεν έγινε η μεταφορά", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  if (device.storeId === store.id) return;
  if (await db.tillShift.count({ where: { deviceId: device.id, endedAt: null } })) { await flashFail("Δεν έγινε η μεταφορά: η βάρδια στο ταμείο είναι ανοιχτή", "Κλείσε τη βάρδια από το ταμείο και δοκίμασε ξανά."); return; }
  const terminal = await checkTerminal({ terminalId: device.vivaTerminalId, orgId: org.id, storeId: store.id, deviceId: device.id });
  if (terminal) { await flashFail(`Δεν έγινε η μεταφορά: ${terminal}`, "Άλλαξε πρώτα το τερματικό της συσκευής."); return; }
  await db.device.update({ where: { id: device.id }, data: { storeId: store.id, defaultWarehouseId: null, linkedDeviceId: null } });
  revalidatePath("/devices");
  await flashOk(`Το «${device.name}» είναι τώρα στο ${store.name}`);
}

const stationField = z.enum(["", "KITCHEN", "BAR"]).transform((v) => (v === "" ? null : v));
const minutes = z.coerce.number().int().min(1).max(120);

/** Οθόνη κουζίνας: τι δείχνει, όρια χρόνου, και σε ποιον σταθμό πάει κάθε κατηγορία (κοινό για όλη την επιχείρηση). */
export async function saveKitchen(deviceId: string, form: FormData) {
  const { org } = await currentOrg("devices.edit");
  const parsed = z.object({ station: stationField, kdsWarnMin: minutes, kdsLateMin: minutes }).refine((v) => v.kdsWarnMin < v.kdsLateMin).safeParse(Object.fromEntries(form));
  if (!parsed.success) { await flashFail("Δεν αποθηκεύτηκε: το κίτρινο πρέπει να έρχεται πριν από το κόκκινο", "Τα λεπτά είναι από 1 ως 120."); return; }
  const device = await db.device.findFirst({ where: { id: deviceId, orgId: org.id, kind: "KITCHEN_DISPLAY" }, select: { id: true, name: true } });
  if (!device) { await flashFail("Δεν αποθηκεύτηκε: η οθόνη δεν βρέθηκε", "Ανανέωσε τη σελίδα και δοκίμασε ξανά."); return; }
  const cats = await db.category.findMany({ where: { orgId: org.id }, select: { id: true } });
  await db.$transaction([
    db.device.update({ where: { id: device.id }, data: parsed.data }),
    ...cats.flatMap((c) => {
      const v = stationField.safeParse(form.get(`cat-${c.id}`) ?? "");
      return v.success ? [db.category.update({ where: { id: c.id }, data: { station: v.data } })] : [];
    }),
  ]);
  revalidatePath(`/devices/kitchen/${device.id}`);
  await flashOk(`Η οθόνη «${device.name}» αποθηκεύτηκε`);
}
