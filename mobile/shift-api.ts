// Βάρδιες ταμία και κλείσιμο ημέρας (web/app/api/pos/shift, day).
import { call, type Session } from "./api";

export type Staff = { id: string; name: string; scheduled: string | null; onLeave: boolean };
export type Figures = {
  incomeCents: number; cardCents: number; cashCents: number; receipts: number;
  refunds: number; refundCents: number; refundCashCents: number; hours: { h: number; card: number; cash: number }[];
};
export type OpenShift = { id: string; employee: { id: string; name: string }; startedAt: string; openingCents: number };
/** on=false: το κατάστημα δεν έχει προσωπικό με PIN ταμείου, το ταμείο δουλεύει χωρίς βάρδιες. */
export type ShiftState =
  | { on: false }
  | { on: true; dayClosed: boolean; staff: Staff[]; shift: OpenShift | null; suggested: { cents: number; by: string; at: string } | null; report: { figures: Figures; expectedCents: number } | null };
export type DayRow = {
  id: string; name: string; startedAt: string; endedAt: string | null; open: boolean; receipts: number; cardCents: number; cashCents: number; incomeCents: number;
  expectedCents: number; countedCents: number | null; keptCents: number | null; reason: string | null;
};
export type DayReport = {
  day: string; figures: Figures; prevIncomeCents: number; rows: DayRow[]; closed: { closedAt: string; closedBy: string } | null;
  blockers: string[]; diffCents: number; depositCents: number; keptCents: number; countedCents: number;
};

export const getShift = async (s: Session, report = false) => (await call<ShiftState>(s, `/shift${report ? "?report=1" : ""}`)).data;
export const startShift = (s: Session, employeeId: string, pin: string, openingCents: number) => call(s, "/shift", { action: "start", employeeId, pin, openingCents });
export const closeShift = async (s: Session, countedCents: number, keptCents: number, reason?: string) =>
  (await call<{ diffCents: number }>(s, "/shift", { action: "close", countedCents, keptCents, reason })).data;
export const getDayReport = async (s: Session, date: string) => (await call<DayReport>(s, `/day?date=${date}`)).data;
export const closeDay = (s: Session, date: string) => call(s, "/day", { date });
