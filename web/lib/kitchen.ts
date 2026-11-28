// Οθόνη κουζίνας: τα δελτία του καταστήματος, «έτοιμο» ανά είδος ή ανά δελτίο, αναίρεση και η απόδοση της ημέρας.
// Ο σερβιτόρος μαθαίνει το «έτοιμο» από τη λίστα των λογαριασμών (billStage → readyIds), όχι με ειδοποίηση.
import { db } from "./db";
import { type DoneLine, type Station, stats, tickets, totals } from "./kitchen-board";

export type { Station };

type Ctx = { org: { id: string }; store: { id: string } };

// shortcut: δελτία ως 12 ώρες πίσω· γύρος που ξεχάστηκε από χθες δεν μένει για πάντα στην οθόνη
const BOARD_HOURS = 12;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const stationOf = (station?: Station | null) => ({ category: { station: station ?? { not: null } } });

/**
 * Η οθόνη: τα δελτία όλων των σταθμών (η εφαρμογή φιλτράρει και μετρά «Κουζίνα · 5 / Bar · 3»), ό,τι περιμένει στο
 * «Μετά» και τα νούμερα της ημέρας για τον σταθμό της οθόνης.
 */
export async function kitchenBoard(ctx: Ctx, station: Station | null, lateMin: number) {
  const since = new Date(Date.now() - BOARD_HOURS * 3600_000);
  const lineSel = {
    id: true, name: true, quantity: true, options: true, note: true, seat: true, readyAt: true, servedAt: true, voidedAt: true,
    product: { select: { category: { select: { station: true } } } },
  } as const;
  const roundSel = {
    id: true, number: true, sentAt: true, sentByName: true,
    bill: { select: { label: true, openedByName: true, table: { select: { name: true } } } },
    lines: { where: { product: stationOf() }, select: lineSel },
  } as const;
  const bill = { orgId: ctx.org.id, storeId: ctx.store.id };
  const [live, held, done] = await Promise.all([
    db.billRound.findMany({ where: { held: false, sentAt: { gte: since }, bill, lines: { some: { readyAt: null, servedAt: null, voidedAt: null, product: stationOf() } } }, orderBy: { sentAt: "asc" }, select: roundSel }),
    db.billRound.findMany({ where: { held: true, bill: { ...bill, status: "OPEN" }, lines: { some: { voidedAt: null, product: stationOf() } } }, orderBy: { sentAt: "asc" }, select: roundSel }),
    doneToday(ctx, station),
  ]);
  const toRound = (r: (typeof live)[number]) => ({
    id: r.id, number: r.number, sentAt: r.sentAt, sentByName: r.sentByName, table: r.bill.table?.name ?? null, label: r.bill.label, waiter: r.bill.openedByName,
    lines: r.lines.map(({ product, ...l }) => ({ ...l, station: product.category.station })),
  });
  const ts = tickets(live.map(toRound));
  return {
    tickets: ts,
    // στο «Μετά» το sentAt είναι η ώρα που γράφτηκε· το readyAt δεν μετρά ακόμα
    coming: tickets(held.map(toRound).map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l, readyAt: null })) }))).map((t) => ({ key: t.key, station: t.station, title: t.title, since: t.sentAt, items: totals([t]) })),
    today: stats(done, lateMin),
  };
}

/** Ό,τι ετοιμάστηκε σήμερα στον σταθμό (κενό = όλους), για τον μέσο χρόνο. */
async function doneToday(ctx: Ctx, station: Station | null): Promise<DoneLine[]> {
  const rows = await db.billLine.findMany({
    where: { readyAt: { gte: startOfDay() }, voidedAt: null, bill: { orgId: ctx.org.id, storeId: ctx.store.id }, product: stationOf(station) },
    select: { roundId: true, readyAt: true, round: { select: { sentAt: true } }, product: { select: { category: { select: { station: true } } } } },
  });
  return rows.map((l) => ({ roundId: l.roundId, station: l.product.category.station!, sentAt: l.round.sentAt, readyAt: l.readyAt! }));
}

/** Η απόδοση της ημέρας για τη σελίδα της οθόνης στη web εφαρμογή. */
export const kitchenToday = async (ctx: Ctx, station: Station | null, lateMin: number) => stats(await doneToday(ctx, station), lateMin);

/** Τσεκ σε ένα είδος (ή αναίρεση). Μόνο είδη του καταστήματος που βγήκαν από το «Μετά» και δεν ακυρώθηκαν. */
export async function markReady(ctx: Ctx, lineIds: string[], ready: boolean) {
  const r = await db.billLine.updateMany({
    where: { id: { in: lineIds }, voidedAt: null, bill: { orgId: ctx.org.id, storeId: ctx.store.id }, round: { held: false }, ...(ready ? { readyAt: null } : { servedAt: null }) },
    data: { readyAt: ready ? new Date() : null },
  });
  return { count: r.count };
}

/** «Έτοιμο» σε όλο το δελτίο: γράφει όσα έλειπαν και τα επιστρέφει, για την «Αναίρεση». */
export async function bumpTicket(ctx: Ctx, roundId: string, station: Station) {
  const where = { roundId, readyAt: null, voidedAt: null, bill: { orgId: ctx.org.id, storeId: ctx.store.id }, round: { held: false }, product: stationOf(station) };
  const ids = (await db.billLine.findMany({ where, select: { id: true } })).map((l) => l.id);
  if (ids.length) await db.billLine.updateMany({ where: { ...where, id: { in: ids } }, data: { readyAt: new Date() } });
  return { lineIds: ids };
}

/** Ρυθμίσεις της οθόνης που χρειάζεται η εφαρμογή. */
export async function kitchenDevice(deviceId: string) {
  return db.device.findUniqueOrThrow({ where: { id: deviceId }, select: { name: true, station: true, kdsWarnMin: true, kdsLateMin: true, store: { select: { name: true } } } });
}
