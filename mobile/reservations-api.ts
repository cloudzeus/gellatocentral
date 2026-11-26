// Κλήσεις κρατήσεων προς τον server (web/app/api/pos/reservations).
import { call, type Session } from "./api";
import type { Day, Guest, NewReservation } from "./reservations";

export const getDay = async (s: Session, date: string) => (await call<Day>(s, `/reservations?date=${date}`)).data;
export const findGuest = async (s: Session, phone: string) => (await call<{ guest: Guest | null }>(s, `/reservations?phone=${encodeURIComponent(phone)}`)).data.guest;
export const createReservation = async (s: Session, r: NewReservation) => (await call<{ id: string }>(s, "/reservations", r)).data;
export const seatReservation = async (s: Session, id: string, tableId?: string) => (await call<{ billId: string }>(s, `/reservations/${id}`, { action: "seat", tableId })).data;
export const closeReservation = (s: Session, id: string, action: "no_show" | "cancel") => call(s, `/reservations/${id}`, { action });
