// Βάρδιες ταμία σε ταμείο Android: ποιος δουλεύει, τι εισέπραξε, πόσα πρέπει να έχει το συρτάρι, κλείσιμο ημέρας.
// Οι πωλήσεις της βάρδιας είναι όσες έγιναν στο ταμείο μέσα στο διάστημά της (μία ανοιχτή βάρδια ανά ταμείο, κανόνας της βάσης).
import { createHash, timingSafeEqual } from "node:crypto";
import { writeAudit } from "./audit";
import { db } from "./db";
import { Prisma } from "./generated/prisma/client";
import { tenantWriteTransaction } from "./migration-cutover";
import { waiterBills } from "./bills";
import { athensDayRange } from "./production-day-close";
import { expectedCash, sumMovements, type Figures } from "./till-figures";
import { isSpecialty, roleHasCash, roleViews, specialtyGroup, specialtyName, suggestedRole } from "./specialties";

export class ShiftError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

type Ctx = { org: { id: string }; device: { id: string; storeId: string; name: string } };

export const pinHash = (employeeId: string, pin: string) => createHash("sha256").update(`${employeeId}:${pin}`).digest("hex");
export const athensDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
const hhmm = (d: Date) => d.toLocaleTimeString("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Βάρδιες ισχύουν μόνο όταν το κατάστημα έχει έστω έναν υπάλληλο με PIN ταμείου· αλλιώς το ταμείο δουλεύει όπως πριν. */
export const shiftsOn = async (ctx: Ctx) =>
  (await db.employee.count({ where: { orgId: ctx.org.id, stores: { some: { storeId: ctx.device.storeId } }, active: true, tillPinHash: { not: null } } })) > 0;

export const openShift = (deviceId: string) =>
  db.tillShift.findFirst({ where: { deviceId, endedAt: null }, include: { employee: { select: { id: true, name: true } } } });

/** Η ανοιχτή βάρδια για την εφαρμογή, με τον ρόλο και το όνομά του. */
export const shiftView = (s: NonNullable<Awaited<ReturnType<typeof openShift>>>) =>
  ({ id: s.id, employee: s.employee, startedAt: s.startedAt, openingCents: s.openingCents, role: s.role, roleName: specialtyName(s.role), roleGroup: specialtyGroup(s.role) });

/** Πύλη για ό,τι εισπράττει ή επιστρέφει χρήματα: χωρίς ανοιχτή βάρδια (όταν οι βάρδιες ισχύουν) απαντά 409. */
export async function shiftResponse(ctx: Ctx) {
  if (!(await shiftsOn(ctx)) || (await openShift(ctx.device.id))) return null;
  return Response.json({ error: "no_shift", message: "Ξεκίνα βάρδια με το όνομα και το PIN σου για να εισπράξεις" }, { status: 409 });
}

/** Το προσωπικό του καταστήματος που μπαίνει στο ταμείο: πρώτα όσοι είναι στο πρόγραμμα της ημέρας. */
export async function tillStaff(ctx: Ctx, now = new Date()) {
  const { start, end } = athensDayRange(athensDay(now));
  const staff = await db.employee.findMany({
    where: { orgId: ctx.org.id, stores: { some: { storeId: ctx.device.storeId } }, active: true, tillPinHash: { not: null } },
    select: {
      id: true, name: true,
      specialties: { select: { specialty: true, isPrimary: true } },
      // η βάρδια της ημέρας σε αυτό το κατάστημα (σε άλλο κατάστημα δεν δίνει πρόταση ρόλου εδώ)
      shifts: { where: { startsAt: { lt: end }, endsAt: { gt: start }, OR: [{ storeId: ctx.device.storeId }, { storeId: null }] }, select: { startsAt: true, endsAt: true, specialty: true }, orderBy: { startsAt: "asc" }, take: 1 },
      leaves: { where: { fromAt: { lte: now }, toAt: { gte: now } }, select: { id: true }, take: 1 },
    },
    orderBy: { name: "asc" },
  });
  return staff
    .map((e) => ({
      id: e.id, name: e.name, onLeave: e.leaves.length > 0, startsAt: e.shifts[0]?.startsAt.getTime() ?? Infinity,
      scheduled: e.shifts[0] ? `${hhmm(e.shifts[0].startsAt)}–${hhmm(e.shifts[0].endsAt)}${e.shifts[0].specialty ? ` ${specialtyName(e.shifts[0].specialty)}` : ""}` : null,
      roles: [...e.specialties].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).filter((s) => isSpecialty(s.specialty)).map((s) => ({ key: s.specialty, name: specialtyName(s.specialty)!, group: specialtyGroup(s.specialty), cash: roleHasCash(s.specialty), views: roleViews(s.specialty) })),
      suggested: suggestedRole(e.specialties, e.shifts[0]?.specialty),
    }))
    .sort((a, b) => a.startsAt - b.startsAt)
    .map(({ startsAt: _, ...e }) => e);
}

// shortcut: μετρητής λαθών στη μνήμη του server (5 λάθη → 5′ κλείδωμα ανά ταμείο)· σε πολλούς servers θέλει κοινό χώρο (Redis/βάση)
const misses = new Map<string, { n: number; until: number }>();

export async function startShift(ctx: Ctx, input: { employeeId: string; pin: string; openingCents: number; role?: string | null }) {
  const lock = misses.get(ctx.device.id);
  if (lock && lock.until > Date.now()) throw new ShiftError("locked", "Πολλά λάθος PIN. Δοκίμασε ξανά σε λίγα λεπτά");
  const open = await openShift(ctx.device.id);
  if (open) throw new ShiftError("shift_open", `Η βάρδια του/της ${open.employee.name} είναι ακόμα ανοιχτή. Κλείσ' την πρώτα`);
  if (await db.tillDayClose.findUnique({ where: { deviceId_day: { deviceId: ctx.device.id, day: athensDay(new Date()) } } }))
    throw new ShiftError("day_closed", "Η ημέρα έκλεισε σε αυτό το ταμείο. Νέα βάρδια από αύριο");
  const employee = await db.employee.findFirst({ where: { id: input.employeeId, orgId: ctx.org.id, stores: { some: { storeId: ctx.device.storeId } }, active: true }, select: { id: true, name: true, tillPinHash: true, specialties: { select: { specialty: true } } } });
  const given = Buffer.from(pinHash(input.employeeId, input.pin));
  if (!employee?.tillPinHash || !timingSafeEqual(given, Buffer.from(employee.tillPinHash))) {
    const n = (lock && lock.until > Date.now() - 300_000 ? lock.n : 0) + 1;
    misses.set(ctx.device.id, { n, until: n >= 5 ? Date.now() + 300_000 : Date.now() });
    throw new ShiftError("wrong_pin", "Λάθος PIN");
  }
  misses.delete(ctx.device.id);
  // με ειδικότητες: ο ρόλος είναι υποχρεωτικός και δικός του· χωρίς: όπως πριν, χωρίς ρόλο
  const roles = employee.specialties.map((s) => s.specialty).filter(isSpecialty);
  const role = roles.length ? (input.role && roles.includes(input.role) ? input.role : roles.length === 1 ? roles[0] : null) : null;
  if (roles.length && !role) throw new ShiftError("role_required", "Διάλεξε με ποιον ρόλο μπαίνεις");
  const openingCents = roleHasCash(role) ? input.openingCents : 0;
  try {
    const shift = await db.tillShift.create({ data: { orgId: ctx.org.id, deviceId: ctx.device.id, employeeId: employee.id, openingCents, role } });
    await tenantWriteTransaction(ctx.org.id, (tx) => writeAudit(tx, {
      orgId: ctx.org.id, actor: { id: null, name: employee.name }, action: "till.shift.start", entityType: "device", entityId: ctx.device.id,
      storeId: ctx.device.storeId, metadata: { shiftId: shift.id, openingCents, role },
    }));
    return shift;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ShiftError("shift_open", "Ξεκίνησε ήδη βάρδια σε αυτό το ταμείο");
    throw e;
  }
}

const isCash = (m: { code: string; givesChange: boolean }) => m.givesChange || m.code === "cash";

/** Ό,τι εισπράχθηκε και επιστράφηκε στο ταμείο μέσα στο [from, to). */
export async function tillFigures(ctx: Ctx, from: Date, to: Date): Promise<Figures> {
  const range = { gte: from, lt: to };
  const method = { select: { code: true, givesChange: true } };
  const [payments, receipts, shares, credits] = await Promise.all([
    db.payment.findMany({ where: { sale: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "COMPLETED", issuedAt: range } }, select: { amountCents: true, method, sale: { select: { issuedAt: true } } } }),
    db.sale.count({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "COMPLETED", issuedAt: range } }),
    // μερίδια λογαριασμού: μετρούν όταν πληρώθηκαν, όχι όταν κόπηκε η απόδειξη του υπολοίπου
    db.billShare.findMany({ where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "PAID", paidAt: range }, select: { amountCents: true, paidAt: true, method } }),
    db.fiscalDocument.findMany({
      where: { orgId: ctx.org.id, docType: "11.4", status: { in: ["SIGNED", "NOT_SENT"] }, createdAt: range, related: { sale: { deviceId: ctx.device.id } } },
      select: { createdAt: true, related: { select: { sale: { select: { totalCents: true, payment: { select: { method } } } } } } },
    }),
  ]);
  return sumMovements([
    ...payments.map((p) => ({ at: p.sale.issuedAt ?? to, cents: p.amountCents, cash: isCash(p.method) })),
    ...shares.map((s) => ({ at: s.paidAt ?? to, cents: s.amountCents, cash: isCash(s.method) })),
    ...credits.map((c) => ({ at: c.createdAt, cents: c.related?.sale?.totalCents ?? 0, cash: c.related?.sale?.payment ? isCash(c.related.sale.payment.method) : false, refund: true })),
  ], receipts);
}


/** Η τρέχουσα βάρδια και ό,τι χρειάζεται η οθόνη κλεισίματος. */
export async function shiftReport(ctx: Ctx) {
  const shift = await openShift(ctx.device.id);
  if (!shift) return null;
  const [figures, openBills] = await Promise.all([tillFigures(ctx, shift.startedAt, new Date()), waiterBills(ctx.org.id, ctx.device.storeId, shift.employeeId)]);
  return { shift: shiftView(shift), figures, expectedCents: expectedCash(shift.openingCents, figures), openBills };
}

export async function closeShift(ctx: Ctx, input: { countedCents: number; keptCents: number; reason?: string }) {
  const report = await shiftReport(ctx);
  if (!report) throw new ShiftError("no_shift", "Δεν υπάρχει ανοιχτή βάρδια");
  if (input.keptCents > input.countedCents) throw new ShiftError("invalid", "Δεν μπορείς να αφήσεις περισσότερα από όσα μέτρησες");
  const diff = input.countedCents - report.expectedCents;
  if (diff !== 0 && !input.reason?.trim()) throw new ShiftError("reason_required", "Γράψε τι έγινε με τη διαφορά");
  if (report.openBills.length)
    throw new ShiftError("open_bills", `Έχεις ${report.openBills.length === 1 ? "ένα ανοιχτό τραπέζι" : `${report.openBills.length} ανοιχτά τραπέζια`}. Κλείσε τα ή παράδωσέ τα σε συνάδελφο`);
  if (await db.sale.count({ where: { deviceId: ctx.device.id, status: "AWAITING_PAYMENT" } }))
    throw new ShiftError("pending_charge", "Μια χρέωση περιμένει στο POS. Ολοκλήρωσέ την ή ακύρωσέ την από τις Συναλλαγές");
  const { count } = await db.tillShift.updateMany({
    where: { id: report.shift.id, endedAt: null },
    data: { endedAt: new Date(), expectedCents: report.expectedCents, countedCents: input.countedCents, keptCents: input.keptCents, reason: input.reason?.trim() || null, summary: report.figures },
  });
  if (!count) throw new ShiftError("no_shift", "Η βάρδια έκλεισε ήδη");
  await tenantWriteTransaction(ctx.org.id, (tx) => writeAudit(tx, {
    orgId: ctx.org.id, actor: { id: null, name: report.shift.employee.name }, action: "till.shift.close", entityType: "device", entityId: ctx.device.id,
    storeId: ctx.device.storeId, reason: input.reason?.trim() || undefined,
    metadata: { shiftId: report.shift.id, expectedCents: report.expectedCents, countedCents: input.countedCents, diffCents: diff, keptCents: input.keptCents },
  }));
  return { diffCents: diff };
}

/** Ο σερβιτόρος που φεύγει παραδίδει όλα τα ανοιχτά τραπέζια του σε συνάδελφο του καταστήματος. */
export async function handOver(ctx: Ctx, toEmployeeId: string) {
  const shift = await openShift(ctx.device.id);
  if (!shift) throw new ShiftError("no_shift", "Δεν υπάρχει ανοιχτή βάρδια");
  if (toEmployeeId === shift.employeeId) throw new ShiftError("invalid", "Διάλεξε άλλον συνάδελφο");
  const to = await db.employee.findFirst({ where: { id: toEmployeeId, orgId: ctx.org.id, stores: { some: { storeId: ctx.device.storeId } }, active: true, tillPinHash: { not: null } }, select: { id: true, name: true } });
  if (!to) throw new ShiftError("invalid", "Ο συνάδελφος δεν βρέθηκε σε αυτό το κατάστημα");
  const bills = await db.bill.findMany({ where: { orgId: ctx.org.id, storeId: ctx.device.storeId, status: "OPEN", waiterId: shift.employeeId }, select: { id: true } });
  if (!bills.length) return { count: 0, to: to.name };
  // το όνομα στο πλακίδιο είναι ο σερβιτόρος του τραπεζιού· ποιος το άνοιξε μένει στο ημερολόγιο
  const { count } = await db.bill.updateMany({ where: { id: { in: bills.map((b) => b.id) }, status: "OPEN", waiterId: shift.employeeId }, data: { waiterId: to.id, openedByName: to.name } });
  await tenantWriteTransaction(ctx.org.id, (tx) => writeAudit(tx, {
    orgId: ctx.org.id, actor: { id: null, name: shift.employee.name }, action: "pos.bill.handover", entityType: "device", entityId: ctx.device.id,
    storeId: ctx.device.storeId, metadata: { shiftId: shift.id, from: shift.employeeId, to: to.id, billIds: bills.map((b) => b.id) },
  }));
  return { count, to: to.name };
}

/** Μετρητά που άφησε η τελευταία κλειστή βάρδια: η πρόταση για τα μετρητά έναρξης. */
export const lastKept = async (deviceId: string) =>
  (await db.tillShift.findFirst({ where: { deviceId, endedAt: { not: null } }, orderBy: { endedAt: "desc" }, select: { keptCents: true, endedAt: true, employee: { select: { name: true } } } })) ?? null;

/** Τι εμποδίζει το κλείσιμο ημέρας (κενό = μπορεί να κλείσει). */
async function blockers(ctx: Ctx) {
  const [open, charges, shares, credits, bills] = await Promise.all([
    openShift(ctx.device.id),
    db.sale.count({ where: { deviceId: ctx.device.id, status: "AWAITING_PAYMENT" } }),
    db.billShare.count({ where: { deviceId: ctx.device.id, status: "PENDING" } }),
    db.fiscalDocument.count({ where: { orgId: ctx.org.id, docType: "11.4", status: "PENDING", related: { sale: { deviceId: ctx.device.id } } } }),
    db.bill.count({ where: { orgId: ctx.org.id, storeId: ctx.device.storeId, status: "OPEN" } }),
  ]);
  return [
    open ? `Η βάρδια του/της ${open.employee.name} είναι ανοιχτή` : null,
    charges || shares ? "Μια χρέωση περιμένει στο POS" : null,
    credits ? "Μια επιστροφή περιμένει στο POS" : null,
    bills ? `${bills === 1 ? "Ένας λογαριασμός τραπεζιού είναι ανοιχτός" : `${bills} λογαριασμοί τραπεζιών είναι ανοιχτοί`}` : null,
  ].filter((x): x is string => !!x);
}

export async function dayReport(ctx: Ctx, day: string) {
  const { start, end } = athensDayRange(day);
  const weekAgo = athensDayRange(athensDay(new Date(start.getTime() - 6.5 * 86_400_000)));
  const [shifts, figures, prev, closed, blocking] = await Promise.all([
    db.tillShift.findMany({ where: { deviceId: ctx.device.id, startedAt: { gte: start, lt: end } }, include: { employee: { select: { name: true } } }, orderBy: { startedAt: "asc" } }),
    tillFigures(ctx, start, end),
    tillFigures(ctx, weekAgo.start, weekAgo.end),
    db.tillDayClose.findUnique({ where: { deviceId_day: { deviceId: ctx.device.id, day } }, select: { closedAt: true, closedBy: true } }),
    blockers(ctx),
  ]);
  const now = new Date();
  const rows = await Promise.all(shifts.map(async (s) => {
    const f = s.summary ? (s.summary as unknown as Figures) : await tillFigures(ctx, s.startedAt, s.endedAt ?? now);
    return {
      id: s.id, name: s.employee.name, startedAt: s.startedAt, endedAt: s.endedAt, open: !s.endedAt,
      receipts: f.receipts, cardCents: f.cardCents, cashCents: f.cashCents, incomeCents: f.incomeCents,
      expectedCents: s.expectedCents ?? expectedCash(s.openingCents, f), countedCents: s.countedCents, keptCents: s.keptCents, reason: s.reason,
    };
  }));
  const last = rows.findLast((r) => !r.open);
  const counted = rows.reduce((n, r) => n + (r.countedCents ?? 0), 0);
  return {
    day, figures, prevIncomeCents: prev.incomeCents, rows, closed, blockers: closed ? [] : blocking,
    diffCents: rows.reduce((n, r) => n + (r.countedCents == null ? 0 : r.countedCents - r.expectedCents), 0),
    // κατάθεση = ό,τι μετρήθηκε στο κλείσιμο κάθε βάρδιας μείον ό,τι αφέθηκε για την επόμενη
    depositCents: rows.reduce((n, r) => n + (r.countedCents ?? 0) - (r.keptCents ?? 0), 0),
    keptCents: last?.keptCents ?? 0, countedCents: counted,
  };
}

export async function closeDay(ctx: Ctx, day: string) {
  if (day > athensDay(new Date())) throw new ShiftError("invalid", "Δεν κλείνει μέρα που δεν ήρθε ακόμα");
  const report = await dayReport(ctx, day);
  if (report.closed) throw new ShiftError("day_closed", "Η ημέρα έχει ήδη κλείσει");
  if (report.blockers.length) throw new ShiftError("blocked", `Πρώτα: ${report.blockers.join(" · ")}`);
  const by = report.rows.at(-1)?.name ?? ctx.device.name;
  const summary = { figures: report.figures, rows: report.rows, depositCents: report.depositCents, diffCents: report.diffCents } as unknown as Prisma.InputJsonValue;
  try {
    await db.tillDayClose.create({ data: { orgId: ctx.org.id, deviceId: ctx.device.id, day, closedBy: by, summary } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ShiftError("day_closed", "Η ημέρα έχει ήδη κλείσει");
    throw e;
  }
  await tenantWriteTransaction(ctx.org.id, (tx) => writeAudit(tx, {
    orgId: ctx.org.id, actor: { id: null, name: by }, action: "till.day.close", entityType: "device", entityId: ctx.device.id,
    storeId: ctx.device.storeId, metadata: { day, incomeCents: report.figures.incomeCents, depositCents: report.depositCents, diffCents: report.diffCents },
  }));
}
