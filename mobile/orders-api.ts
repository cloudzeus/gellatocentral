// Κλήσεις των παραγγελιών εκτός καταστήματος και της καρτέλας κλήσης (web/app/api/pos/orders, calls, customers).
import { call, type SaleLine, type Session } from "./api";
import type { Customer, LiveCall, Order, OrderStatus } from "./orders";

export const getOrders = async (s: Session) => (await call<{ orders: Order[]; missedCalls: number }>(s, "/orders")).data;
export const moveOrder = async (s: Session, id: string, to: OrderStatus, extra: { readyInMin?: number; reason?: string } = {}) => (await call<{ id: string }>(s, `/orders/${id}`, { to, ...extra })).data;
export type PhoneOrder = { lines: SaleLine[]; name: string; phone?: string; partyId?: string; address?: string; delivery: boolean; payment: "DOOR_CASH" | "DOOR_CARD" | "TILL"; readyInMin: number; note?: string; callId?: string };
export const createPhoneOrder = async (s: Session, o: PhoneOrder) => (await call<{ id: string; billId: string }>(s, "/orders", o)).data;
export const getLiveCall = async (s: Session) => (await call<{ call: LiveCall | null }>(s, "/calls")).data.call;
export const seeCall = (s: Session, id: string) => call(s, "/calls", { id });
export const findCustomer = async (s: Session, phone: string) => (await call<{ customer: Customer | null }>(s, `/customers?phone=${encodeURIComponent(phone)}`)).data.customer;
export const createCustomer = async (s: Session, c: { name: string; phone: string; street: string; city?: string; note?: string }) => (await call<{ customer: Customer }>(s, "/customers", c)).data.customer;
