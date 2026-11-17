// Τα είδη συσκευών και τι σημαίνει το καθένα. Μία πηγή για φόρμες, λίστες και κανόνες.
import type { DeviceKind } from "./generated/prisma/client";

export const DEVICE_KIND: Record<DeviceKind, { label: string; invoices: boolean; storage: boolean; measures: "TEMPERATURE" | "WEIGHT" | null }> = {
  POS_WEB: { label: "Ταμείο browser", invoices: true, storage: false, measures: null },
  POS_ANDROID: { label: "Ταμείο Android", invoices: true, storage: false, measures: null },
  KITCHEN_DISPLAY: { label: "Οθόνη κουζίνας", invoices: false, storage: false, measures: null },
  FRIDGE: { label: "Ψυγείο", invoices: false, storage: true, measures: "TEMPERATURE" },
  VENDING_MACHINE: { label: "Αυτόματος πωλητής", invoices: false, storage: true, measures: "TEMPERATURE" },
  SCALE: { label: "Ζυγαριά", invoices: false, storage: false, measures: "WEIGHT" },
};
export const KIND_OPTIONS = Object.entries(DEVICE_KIND).map(([k, v]): [string, string] => [k, v.label]);
const kinds = (test: (k: (typeof DEVICE_KIND)[DeviceKind]) => boolean) => Object.entries(DEVICE_KIND).filter(([, v]) => test(v)).map(([k]) => k).join(" ");
/** Για το data-for των πεδίων της φόρμας: σε ποια είδη εμφανίζεται κάθε πεδίο (βλ. globals.css). */
export const FOR = { invoicing: kinds((k) => k.invoices), storage: kinds((k) => k.storage), scale: "SCALE", network: kinds(() => true).replace("POS_WEB ", "") };

const STALE_MINUTES = 30;
const num = new Intl.NumberFormat("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Η τελευταία μέτρηση μιας συσκευής σε απλά λόγια: τιμή, αν είναι εντάξει και τι σημαίνει. */
export function readingStatus(device: { tempMin: number | null; tempMax: number | null }, reading: { kind: "TEMPERATURE" | "WEIGHT"; value: number; at: Date } | undefined, now = new Date()) {
  if (!reading) return { tone: "neutral" as const, text: "Καμία μέτρηση ακόμα" };
  const minutes = Math.floor((now.getTime() - reading.at.getTime()) / 60_000);
  if (reading.kind === "WEIGHT") return { tone: "neutral" as const, text: `${num.format(reading.value)} kg` };
  const value = `${num.format(reading.value).replace("-", "−")} °C`;
  // παλιά μέτρηση = δεν ξέρουμε τι γίνεται τώρα: πιο σοβαρό από μια τιμή εντός ορίων
  if (minutes > STALE_MINUTES) return { tone: "warning" as const, text: `${value} · χωρίς σήμα ${minutes >= 120 ? `${Math.floor(minutes / 60)} ώρες` : `${minutes}′`}` };
  if (device.tempMax !== null && reading.value > device.tempMax) return { tone: "danger" as const, text: `${value} · πάνω από το όριο` };
  if (device.tempMin !== null && reading.value < device.tempMin) return { tone: "danger" as const, text: `${value} · κάτω από το όριο` };
  return { tone: "success" as const, text: value };
}
