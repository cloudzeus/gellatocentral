// Κλήσεις της οθόνης «Συναλλαγές» προς τον server (web/app/api/pos/transactions, sales/[id]/refund, credits/[id]).
import { call, type Session } from "./api";
import type { Tx } from "./transactions";

export type CreditState = "completed" | "pending" | "failed";
export const getTransactions = async (s: Session, date: string) => (await call<{ date: string; rows: Tx[] }>(s, `/transactions?date=${date}`)).data.rows;
export const refund = async (s: Session, saleId: string, reason: string) => (await call<{ creditId: string; amountCents: number; state: CreditState }>(s, `/sales/${saleId}/refund`, { reason })).data;
export const creditState = async (s: Session, id: string) => (await call<{ state: CreditState }>(s, `/credits/${id}`)).data.state;
export const cancelRefund = async (s: Session, id: string) => (await call<{ state: CreditState }>(s, `/credits/${id}`, { cancel: true })).data.state;
