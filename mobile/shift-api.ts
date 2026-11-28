// Βάρδιες ταμία και κλείσιμο ημέρας (web/app/api/pos/shift, day).
import { call, type Session } from "./api";

export type Role = { key: string; name: string; group: string | null; cash: boolean; views: View[] };
/** roles: οι ειδικότητες του ατόμου (κενό = όλα τα μενού)· suggested: αυτή της βάρδιας του προγράμματος ή η κύρια. */
export type Staff = { id: string; name: string; scheduled: string | null; onLeave: boolean; roles: Role[]; suggested: string | null };
/** Τα μενού που ανοίγει ο ρόλος της βάρδιας (web/lib/specialties.ts). */
export type View = "sale" | "tables" | "reservations" | "orders" | "transactions" | "receiving" | "stock";
export type Figures = {
  incomeCents: number; cardCents: number; cashCents: number; receipts: number;
  refunds: number; refundCents: number; refundCashCents: number; hours: { h: number; card: number; cash: number }[];
};
export type OpenShift = { id: string; employee: { id: string; name: string }; startedAt: string; openingCents: number; role: string | null; roleName: string | null; roleGroup: string | null; cash: boolean };
/** Ανοιχτός λογαριασμός του σερβιτόρου της βάρδιας: πριν τη λήξη κλείνει ή παραδίδεται. */
export type OpenBill = { id: string; name: string; openedAt: string; dueCents: number; items: number };
/** on=false: το κατάστημα δεν έχει προσωπικό με PIN ταμείου, το ταμείο δουλεύει χωρίς βάρδιες. */
export type ShiftState =
  | { on: false; views: View[] }
  | { on: true; views: View[]; dayClosed: boolean; staff: Staff[]; shift: OpenShift | null; suggested: { cents: number; by: string; at: string } | null; report: { figures: Figures; expectedCents: number; openBills?: OpenBill[] } | null };
export type DayRow = {
  id: string; name: string; startedAt: string; endedAt: string | null; open: boolean; receipts: number; cardCents: number; cashCents: number; incomeCents: number;
  expectedCents: number; countedCents: number | null; keptCents: number | null; reason: string | null;
};
export type DayReport = {
  day: string; figures: Figures; prevIncomeCents: number; rows: DayRow[]; closed: { closedAt: string; closedBy: string } | null;
  blockers: string[]; diffCents: number; depositCents: number; keptCents: number; countedCents: number;
};

export const getShift = async (s: Session, report = false) => (await call<ShiftState>(s, `/shift${report ? "?report=1" : ""}`)).data;
export const startShift = (s: Session, employeeId: string, pin: string, openingCents: number, role?: string) => call(s, "/shift", { action: "start", employeeId, pin, openingCents, role });
export const closeShift = async (s: Session, countedCents: number, keptCents: number, reason?: string) =>
  (await call<{ diffCents: number }>(s, "/shift", { action: "close", countedCents, keptCents, reason })).data;
export const handOver = async (s: Session, toEmployeeId: string) => (await call<{ count: number; to: string }>(s, "/shift", { action: "handover", toEmployeeId })).data;
export const getDayReport = async (s: Session, date: string) => (await call<DayReport>(s, `/day?date=${date}`)).data;
export const closeDay = (s: Session, date: string) => call(s, "/day", { date });
