// Οθόνη κουζίνας: ό,τι στέλνει ο server (web/lib/kitchen.ts) και οι κινήσεις της.
import { call, type Session } from "./api";

export type Station = "KITCHEN" | "BAR";
export type KTicket = {
  key: string; roundId: string; station: Station; number: number; title: string; waiter: string | null; sentAt: string;
  lines: { id: string; name: string; quantity: number; options: string; note: string | null; seat: number | null; ready: boolean; voided: boolean }[];
};
export type Board = {
  device: { name: string; station: Station | null; kdsWarnMin: number; kdsLateMin: number; store: { name: string } };
  tickets: KTicket[];
  coming: { key: string; station: Station; title: string; since: string; items: { name: string; quantity: number }[] }[];
  today: { count: number; avgMin: number; late: number };
};

export const getBoard = async (s: Session) => (await call<Board>(s, "/kitchen")).data;
export const setReady = (s: Session, lineIds: string[], ready: boolean) => call(s, "/kitchen", { action: "line", lineIds, ready });
export const bump = async (s: Session, roundId: string, station: Station) => (await call<{ lineIds: string[] }>(s, "/kitchen", { action: "bump", roundId, station })).data.lineIds;
