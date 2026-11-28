// Κλήσεις της παραλαβής προς τον server (web/app/api/pos/receiving).
import { call, type Session } from "./api";
import type { DeliveryNote, ReceivingOrder, Spot, submission } from "./receiving";

export const getOpenOrders = async (s: Session) => (await call<{ orders: ReceivingOrder[] }>(s, "/receiving")).data.orders;
export const readNote = async (s: Session, base64: string) => (await call<DeliveryNote>(s, "/receiving/scan", { mime: "image/jpeg", base64 })).data;
export const submitReceipt = async (s: Session, body: ReturnType<typeof submission> & { clientKey: string }) => (await call<{ ok: true }>(s, "/receiving", body)).data;

export type StockItem = { genericItemId: string; warehouseId: string; name: string; dimension: string; qty: number; min: number | null; low: boolean; spot: Spot | null; expiring: { qty: number; expiresAt: string }[] };
export type StockData = { items: StockItem[]; warehouses: { id: string; name: string; spots: Spot[] }[] };
export const getStock = async (s: Session) => (await call<StockData>(s, "/stock")).data;
/** Ορίζει θέση υλικού: υπάρχουσα (spotId) ή νέα με όνομα. */
export const setSpot = async (s: Session, body: { genericItemId: string; warehouseId: string; spotId?: string; name?: string }) => (await call<{ spot: Spot }>(s, "/spots", body)).data.spot;
