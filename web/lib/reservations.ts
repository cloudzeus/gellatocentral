// Κρατήσεις τραπεζιών στον server: λίστα ημέρας, νέα/αλλαγή, «ήρθαν» (ανοίγει λογαριασμό), «δεν ήρθαν», ακύρωση.
// Κανόνες στο ./reservation.ts. Ένα τραπέζι δεν παίρνει δύο ενεργές κρατήσεις που επικαλύπτονται (κλείδωμα γραμμής τραπεζιού).
import { z } from "zod";
import { openBill } from "./bills";
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { tenantWriteTransaction } from "./migration-cutover";
import { athensDayRange } from "./production-day-close";
import { usualItems } from "./order";
import { hourlyLoad, maskPhone, normalizePhone, phase, tableClash } from "./reservation";

type Ctx = { org: { id: string }; store: { id: string }; device: { id: string } };

export class ReservationError extends Error {
  constructor(readonly code: "not_found" | "table_taken" | "table_busy" | "no_table" | "closed", message: string) {
    super(message);
    this.name = "ReservationError";
  }
}

const select = {
  id: true, tableId: true, startsAt: true, durationMin: true, guests: true, name: true, phone: true, note: true, status: true,
  table: { select: { name: true, zone: true } }, bill: { select: { id: true, status: true } },
} satisfies Prisma.ReservationSelect;
type Row = Prisma.ReservationGetPayload<{ select: typeof select }>;

const view = (r: Row, now: Date) => ({
  id: r.id, tableId: r.tableId, tableName: r.table?.name ?? null, startsAt: r.startsAt, durationMin: r.durationMin, guests: r.guests,
  name: r.name, phone: maskPhone(r.phone), note: r.note, status: r.status, billId: r.bill?.status === "OPEN" ? r.bill.id : null,
  phase: phase(r, now, r.bill?.status === "OPEN"),
});

/** Οι κρατήσεις μιας ημέρας (Αθήνα) με την πληρότητα ανά ώρα. Όλες οι συσκευές του καταστήματος βλέπουν τις ίδιες. */
export async function dayReservations(ctx: Ctx, isoDate: string, now = new Date()) {
  const { start, end } = athensDayRange(isoDate);
  const [rows, seats] = await Promise.all([
    db.reservation.findMany({ where: { orgId: ctx.org.id, storeId: ctx.store.id, startsAt: { gte: start, lt: end } }, orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }], select }),
    db.diningTable.aggregate({ where: { orgId: ctx.org.id, storeId: ctx.store.id, active: true }, _sum: { seats: true } }),
  ]);
  const totalSeats = seats._sum.seats ?? 0;
  // Ώρες που δείχνει η λίστα: η Αθήνα μπορεί να έχει 23/25 ώρες στις αλλαγές ώρας· το γράφημα μένει 24 ωριαίες στήλες.
  return { date: isoDate, seats: totalSeats, load: hourlyLoad(rows, start, totalSeats), reservations: rows.map((r) => view(r, now)) };
}

/** Πελάτης που έχει ξανακλείσει: πόσες κρατήσεις, πόσες «δεν ήρθαν», το όνομα και η τελευταία σημείωση. */
export async function guestHistory(ctx: Ctx, phone: string) {
  const digits = normalizePhone(phone);
  if (digits.length < 6) return null;
  const rows = await db.reservation.findMany({
    where: { orgId: ctx.org.id, phone: digits }, orderBy: { startsAt: "desc" }, take: 50,
    select: { name: true, note: true, status: true, startsAt: true, guests: true, table: { select: { name: true } }, bill: { select: { lines: { where: { voidedAt: null }, select: { productId: true, name: true, quantity: true, unitPriceCents: true } } } } },
  });
  if (!rows.length) return null;
  const came = rows.filter((r) => r.bill);
  const tables = new Map<string, number>();
  for (const r of came) if (r.table) tables.set(r.table.name, (tables.get(r.table.name) ?? 0) + 1);
  const favourite = [...tables.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    name: rows[0].name, visits: rows.length, noShows: rows.filter((r) => r.status === "NO_SHOW").length, lastNote: rows.find((r) => r.note)?.note ?? null,
    // «τι παίρνει συνήθως» μόνο όταν υπάρχουν αρκετές επισκέψεις για να σημαίνει κάτι
    usual: came.length >= 3 ? usualItems(came.map((r) => r.bill!.lines)).map((u) => ({ name: u.name, visits: u.visits, of: came.length })) : [],
    lastVisits: came.slice(0, 3).map((r) => ({ at: r.startsAt, guests: r.guests, table: r.table?.name ?? null, totalCents: r.bill!.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0) })),
    favouriteTable: favourite && favourite[1] >= 2 ? favourite[0] : null,
  };
}

/** Τα πεδία που στέλνει το ταμείο (νέα κράτηση· στην αλλαγή όλα προαιρετικά). */
export const reservationBody = z.object({
  tableId: z.string().cuid().nullish(),
  startsAt: z.coerce.date(),
  durationMin: z.number().int().min(15).max(360).optional(),
  guests: z.number().int().min(1).max(99),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/).nullish(),
  note: z.string().trim().max(200).nullish(),
});

export type ReservationInput = { tableId?: string | null; startsAt: Date; durationMin?: number; guests: number; name: string; phone?: string | null; note?: string | null };

/** Κλειδώνει το τραπέζι και ελέγχει ότι είναι ελεύθερο το διάστημα (οι άλλες ενεργές κρατήσεις του). */
async function assertTableFree(tx: Prisma.TransactionClient, ctx: Ctx, tableId: string, startsAt: Date, durationMin: number, exceptId?: string) {
  const [table] = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM "DiningTable" WHERE id = ${tableId} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} AND active FOR UPDATE`;
  if (!table) throw new ReservationError("not_found", "Το τραπέζι δεν υπάρχει σε αυτό το κατάστημα.");
  const window = { gte: new Date(startsAt.getTime() - 24 * 3600_000), lt: new Date(startsAt.getTime() + durationMin * 60_000) };
  const near = await tx.reservation.findMany({ where: { tableId, startsAt: window, status: { in: ["BOOKED", "SEATED"] } }, select: { id: true, tableId: true, startsAt: true, durationMin: true, guests: true, status: true, name: true } });
  const clash = tableClash(near, tableId, startsAt, durationMin, exceptId);
  if (clash) {
    const time = clash.startsAt.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
    throw new ReservationError("table_taken", `Το τραπέζι ${table.name} έχει κράτηση στις ${time} (${near.find((r) => r.id === clash.id)?.name}).`);
  }
}

export async function createReservation(ctx: Ctx, input: ReservationInput, byName?: string) {
  const durationMin = input.durationMin ?? 90;
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    if (input.tableId) await assertTableFree(tx, ctx, input.tableId, input.startsAt, durationMin);
    return tx.reservation.create({
      data: {
        orgId: ctx.org.id, storeId: ctx.store.id, tableId: input.tableId ?? null, startsAt: input.startsAt, durationMin, guests: input.guests,
        name: input.name, phone: input.phone ? normalizePhone(input.phone) : null, note: input.note ?? null, createdByName: byName,
      },
      select: { id: true },
    });
  });
}

async function lockReservation(tx: Prisma.TransactionClient, ctx: Ctx, id: string) {
  const [row] = await tx.$queryRaw<{ id: string; status: string; tableId: string | null; startsAt: Date; durationMin: number; guests: number; name: string }[]>`
    SELECT id, status, "tableId", "startsAt", "durationMin", guests, name FROM "Reservation" WHERE id = ${id} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} FOR UPDATE`;
  if (!row) throw new ReservationError("not_found", "Η κράτηση δεν βρέθηκε.");
  return row;
}

/** Αλλαγή ώρας, ατόμων, τραπεζιού ή στοιχείων. Μόνο σε κλεισμένη κράτηση (όχι αφού κάθισαν). */
export async function updateReservation(ctx: Ctx, id: string, input: Partial<ReservationInput>) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    const r = await lockReservation(tx, ctx, id);
    if (r.status !== "BOOKED") throw new ReservationError("closed", "Η κράτηση δεν αλλάζει πια: έχουν ήδη καθίσει ή έκλεισε.");
    const tableId = input.tableId === undefined ? r.tableId : input.tableId;
    const startsAt = input.startsAt ?? r.startsAt;
    const durationMin = input.durationMin ?? r.durationMin;
    if (tableId) await assertTableFree(tx, ctx, tableId, startsAt, durationMin, id);
    await tx.reservation.update({
      where: { id },
      data: {
        tableId, startsAt, durationMin, guests: input.guests, name: input.name,
        phone: input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null, note: input.note,
      },
    });
  });
}

/**
 * «Ήρθαν»: ανοίγει λογαριασμό στο τραπέζι με τα άτομα της κράτησης και τον δένει. Χωρίς τραπέζι στην κράτηση,
 * ο ταμίας δίνει τώρα ένα. Αν το τραπέζι έχει ήδη ανοιχτό λογαριασμό (δεν έχουν φύγει οι προηγούμενοι), σταματά.
 */
export async function seatReservation(ctx: Ctx, id: string, tableId?: string, byName?: string) {
  const r = await db.reservation.findFirst({ where: { id, orgId: ctx.org.id, storeId: ctx.store.id }, select: { status: true, tableId: true, guests: true, name: true } });
  if (!r) throw new ReservationError("not_found", "Η κράτηση δεν βρέθηκε.");
  if (r.status !== "BOOKED") throw new ReservationError("closed", "Η κράτηση έχει ήδη κλείσει.");
  const table = tableId ?? r.tableId;
  if (!table) throw new ReservationError("no_table", "Διάλεξε τραπέζι για να καθίσουν.");
  const bill = await openBill(ctx, { tableId: table, guests: r.guests, label: r.name, byName });
  if (bill.existing) throw new ReservationError("table_busy", "Το τραπέζι έχει ακόμη ανοιχτό λογαριασμό. Κλείσ' τον ή δώσε άλλο τραπέζι.");
  try {
    await tenantWriteTransaction(ctx.org.id, async (tx) => {
      const locked = await lockReservation(tx, ctx, id);
      if (locked.status !== "BOOKED") throw new ReservationError("closed", "Η κράτηση έκλεισε από άλλη συσκευή.");
      await tx.reservation.update({ where: { id }, data: { status: "SEATED", tableId: table, billId: bill.id } });
    });
  } catch (e) {
    // ο λογαριασμός ανοίχτηκε για αυτή την κράτηση και είναι άδειος: δεν τον αφήνουμε να πιάνει το τραπέζι
    await db.bill.updateMany({ where: { id: bill.id, status: "OPEN", lines: { none: {} } }, data: { status: "CANCELLED", closedAt: new Date() } });
    throw e;
  }
  return { billId: bill.id };
}

/** «Δεν ήρθαν» ή ακύρωση: ελευθερώνει το τραπέζι. Μόνο σε κλεισμένη κράτηση. */
export async function closeReservation(ctx: Ctx, id: string, status: "NO_SHOW" | "CANCELLED") {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    const r = await lockReservation(tx, ctx, id);
    if (r.status !== "BOOKED") throw new ReservationError("closed", "Η κράτηση έχει ήδη κλείσει.");
    await tx.reservation.update({ where: { id }, data: { status } });
  });
}

export const reservationErrorResponse = (e: unknown) =>
  e instanceof ReservationError ? Response.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : 409 }) : null;
