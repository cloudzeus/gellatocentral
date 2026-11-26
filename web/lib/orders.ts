// Παραγγελίες εκτός καταστήματος και αναγνώριση πελάτη από το τηλέφωνο (docs/analysis/OFF-PREMISE-ORDERS.md).
// Πληρωμή στην πόρτα ή στο ταμείο: η παραγγελία ανοίγει λογαριασμό με τις γραμμές της και πληρώνεται από εκεί
// με τη ροή των λογαριασμών (μετρητά/κάρτα/Viva, απόδειξη). Πληρωμένη στην πλατφόρμα: χωρίς λογαριασμό.
import { z } from "zod";
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { tenantWriteTransaction } from "./migration-cutover";
import { canMove, distanceM, type OrderStatus, perMonth } from "./order";
import { type PricedLine, cartLines, priceCart } from "./pos-cart";
import { maskPhone, normalizePhone } from "./reservation";

type Ctx = { org: { id: string }; store: { id: string; latitude?: number | null; longitude?: number | null }; device: { id: string } };

export class OrderError extends Error {
  constructor(readonly code: "not_found" | "bad_move" | "invalid", message: string) {
    super(message);
    this.name = "OrderError";
  }
}

/** Οι πελάτες της επιχείρησης με αυτό το τηλέφωνο (Party.phone, τηλέφωνα επαφής, τηλέφωνα διευθύνσεων). */
export async function partiesByPhone(orgId: string, phone: string) {
  const digits = normalizePhone(phone);
  if (digits.length < 6) return [];
  // τα τηλέφωνα στο CRM γράφονται όπως τα έδωσε ο χρήστης («+30 694 …»): συγκρίνουμε μόνο τα ψηφία
  // shortcut: σάρωση χωρίς ευρετήριο ψηφίων· για μεγάλα CRM στήλη normalizedPhone με ευρετήριο
  const like = `%${digits}`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Party" p WHERE p."orgId" = ${orgId} AND p.active AND (
      regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g') LIKE ${like}
      OR EXISTS (SELECT 1 FROM "PartyChannel" c WHERE c."partyId" = p.id AND c.kind = 'phone' AND regexp_replace(c.value, '\\D', '', 'g') LIKE ${like})
      OR EXISTS (SELECT 1 FROM "PartyAddress" a WHERE a."partyId" = p.id AND regexp_replace(coalesce(a.phone, ''), '\\D', '', 'g') LIKE ${like})
    ) ORDER BY p."updatedAt" DESC LIMIT 3`;
  return rows.map((r) => r.id);
}

const orderSelect = {
  id: true, source: true, externalId: true, customerName: true, phone: true, address: true, delivery: true, status: true, payment: true,
  totalCents: true, note: true, readyAt: true, rejectReason: true, billId: true, createdAt: true, partyId: true,
  lines: { select: { productId: true, name: true, quantity: true, unitPriceCents: true, options: true, note: true } },
  bill: { select: { status: true } },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

const orderView = (o: OrderRow) => ({
  id: o.id, source: o.source, externalId: o.externalId, name: o.customerName, phone: maskPhone(o.phone), address: o.address, delivery: o.delivery,
  status: o.status, payment: o.payment, totalCents: o.totalCents, note: o.note, readyAt: o.readyAt, rejectReason: o.rejectReason, createdAt: o.createdAt,
  billId: o.billId, paid: o.payment === "PLATFORM" || o.bill?.status === "SETTLED",
  lines: o.lines.map((l) => ({ ...l, options: (l.options as { name: string; priceCents: number }[] | null) ?? [] })),
});

/**
 * Η καρτέλα του πελάτη για την κλήση ή τη φόρμα: όνομα, διευθύνσεις με απόσταση, σημείωση διανομής,
 * τελευταίες παραγγελίες (όλα τα κανάλια), παραγγελίες ανά μήνα, κρατήσεις. null = άγνωστος αριθμός.
 */
export async function customerCard(ctx: Ctx, phone: string, now = new Date()) {
  const digits = normalizePhone(phone);
  const [partyId] = await partiesByPhone(ctx.org.id, digits);
  const party = partyId ? await db.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, notes: true, address: true, city: true, latitude: true, longitude: true, addresses: { where: { kind: { in: ["delivery", "other"] } }, select: { id: true, label: true, street: true, city: true, latitude: true, longitude: true, notes: true } } },
  }) : null;
  const orderWhere: Prisma.OrderWhereInput = { orgId: ctx.org.id, OR: [{ phone: digits }, ...(party ? [{ partyId: party.id }] : [])] };
  const [orders, dates, reservations] = await Promise.all([
    db.order.findMany({ where: orderWhere, orderBy: { createdAt: "desc" }, take: 3, select: orderSelect }),
    db.order.findMany({ where: { ...orderWhere, createdAt: { gte: new Date(now.getTime() - 200 * 86400_000) }, status: { notIn: ["REJECTED", "CANCELLED"] } }, select: { createdAt: true } }),
    db.reservation.count({ where: { orgId: ctx.org.id, phone: digits } }),
  ]);
  if (!party && !orders.length) return null;
  const store = ctx.store.latitude != null && ctx.store.longitude != null ? { lat: ctx.store.latitude, lng: ctx.store.longitude } : null;
  const at = (lat: number | null, lng: number | null) => (store && lat != null && lng != null ? distanceM(store, { lat, lng }) : null);
  const addresses = party ? [
    ...(party.address ? [{ id: null as string | null, label: "Έδρα", street: [party.address, party.city].filter(Boolean).join(", "), latitude: party.latitude, longitude: party.longitude, meters: at(party.latitude, party.longitude), note: null as string | null }] : []),
    ...party.addresses.map((a) => ({ id: a.id, label: a.label ?? "Διανομή", street: [a.street, a.city].filter(Boolean).join(", "), latitude: a.latitude, longitude: a.longitude, meters: at(a.latitude, a.longitude), note: a.notes })),
  ] : orders.filter((o) => o.address).slice(0, 1).map((o) => ({ id: null, label: "Τελευταία", street: o.address!, latitude: null, longitude: null, meters: null, note: null }));
  const done = dates.length;
  return {
    partyId: party?.id ?? null,
    name: party?.name ?? orders[0]?.customerName ?? "",
    phone: digits,
    note: party?.notes ?? null,
    store,
    addresses,
    orders: orders.map(orderView),
    months: perMonth(dates.map((d) => d.createdAt), now),
    facts: { orders: done, avgCents: orders.length ? Math.round(orders.reduce((s, o) => s + o.totalCents, 0) / orders.length) : 0, reservations },
  };
}

export const newCustomerBody = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(30).regex(/^[+\d\s().-]*$/),
  street: z.string().trim().min(3).max(120),
  city: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
});

/** Νέος πελάτης από την κλήση: όνομα, τηλέφωνο, διεύθυνση διανομής. */
export async function createCustomer(ctx: Ctx, input: z.infer<typeof newCustomerBody>) {
  const phone = normalizePhone(input.phone);
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    const party = await tx.party.create({
      data: {
        orgId: ctx.org.id, roles: ["customer"], name: input.name, phone,
        channels: { create: { kind: "phone", value: phone, isPrimary: true, label: "Παραγγελίες" } },
        addresses: { create: { kind: "delivery", street: input.street, city: input.city, notes: input.note } },
      },
      select: { id: true },
    });
    return { partyId: party.id };
  });
}

export const phoneOrderBody = z.object({
  lines: cartLines,
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/).optional(),
  partyId: z.string().cuid().optional(),
  address: z.string().trim().max(160).optional(),
  delivery: z.boolean(),
  payment: z.enum(["DOOR_CASH", "DOOR_CARD", "TILL"]),
  readyInMin: z.number().int().min(0).max(240),
  note: z.string().trim().max(200).optional(),
  callId: z.string().cuid().optional(),
  byName: z.string().trim().max(60).optional(),
}).refine((b) => !b.delivery || b.address, { message: "διεύθυνση" });

const sumLines = (lines: PricedLine[]) => lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

/** Λογαριασμός με τις γραμμές της παραγγελίας: από εκεί πληρώνεται και βγαίνει η απόδειξη. */
async function billFor(tx: Prisma.TransactionClient, ctx: Ctx, label: string, lines: PricedLine[], byName?: string) {
  const bill = await tx.bill.create({ data: { orgId: ctx.org.id, storeId: ctx.store.id, label, openedByName: byName }, select: { id: true } });
  const round = await tx.billRound.create({ data: { billId: bill.id, number: 1, deviceId: ctx.device.id, sentByName: byName }, select: { id: true } });
  await tx.billLine.createMany({ data: lines.map((l) => ({ ...l, options: l.options ?? undefined, billId: bill.id, roundId: round.id })) });
  return bill.id;
}

/** Τηλεφωνική παραγγελία: τιμές από τον κατάλογο, αποδεκτή αμέσως με ώρα ετοιμασίας. */
export async function createPhoneOrder(ctx: Ctx, input: z.infer<typeof phoneOrderBody>, now = new Date()) {
  const priced = await priceCart(ctx.org.id, input.lines);
  if (!priced) throw new OrderError("invalid", "Κάποιο είδος δεν υπάρχει πια στον κατάλογο.");
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const partyId = input.partyId && (await db.party.count({ where: { id: input.partyId, orgId: ctx.org.id } })) ? input.partyId : null;
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    const label = `${input.delivery ? "Διανομή" : "Παραλαβή"} · ${input.name}`.slice(0, 60);
    const billId = await billFor(tx, ctx, label, priced, input.byName);
    const order = await tx.order.create({
      data: {
        orgId: ctx.org.id, storeId: ctx.store.id, source: "PHONE", partyId, customerName: input.name, phone, address: input.delivery ? input.address : null,
        delivery: input.delivery, status: "ACCEPTED", payment: input.payment, totalCents: sumLines(priced), note: input.note,
        readyAt: new Date(now.getTime() + input.readyInMin * 60_000), billId, createdByName: input.byName,
        lines: { create: priced.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, options: l.options ?? undefined, note: l.note })) },
      },
      select: { id: true },
    });
    if (input.callId) await tx.call.updateMany({ where: { id: input.callId, orgId: ctx.org.id }, data: { orderId: order.id, partyId: partyId ?? undefined } });
    return { id: order.id, billId };
  });
}

/** Οι παραγγελίες του καταστήματος: οι ανοιχτές όλες και οι κλειστές των τελευταίων 12 ωρών. */
export async function storeOrders(ctx: Ctx, now = new Date()) {
  const rows = await db.order.findMany({
    where: { orgId: ctx.org.id, storeId: ctx.store.id, OR: [{ status: { in: ["NEW", "ACCEPTED", "READY", "OUT"] } }, { updatedAt: { gte: new Date(now.getTime() - 12 * 3600_000) } }] },
    orderBy: { createdAt: "desc" }, take: 100, select: orderSelect,
  });
  const missed = await db.call.count({ where: { orgId: ctx.org.id, state: "MISSED", startedAt: { gte: new Date(now.getTime() - 12 * 3600_000) }, OR: [{ deviceId: ctx.device.id }, { deviceId: null }] } });
  return { orders: rows.map(orderView), missedCalls: missed };
}

export const moveBody = z.object({
  to: z.enum(["ACCEPTED", "READY", "OUT", "DELIVERED", "REJECTED", "CANCELLED"]),
  readyInMin: z.number().int().min(0).max(240).optional(),
  reason: z.string().trim().max(120).optional(),
});

/**
 * Αλλαγή κατάστασης. Αποδοχή παραγγελίας πλατφόρμας: δηλώνει ώρα ετοιμασίας και, όταν δεν είναι πληρωμένη online,
 * ανοίγει λογαριασμό. Απόρριψη/ακύρωση: ακυρώνει τον λογαριασμό αν δεν έχει πληρωθεί τίποτα.
 * shortcut: η αλλαγή δεν στέλνεται ακόμα στη Wolt/efood (θέλει κλειδιά συνεργάτη)· εδώ θα μπει ο προσαρμογέας.
 */
export async function moveOrder(ctx: Ctx, id: string, input: z.infer<typeof moveBody>, byName?: string, now = new Date()) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${id} AND "orgId" = ${ctx.org.id} AND "storeId" = ${ctx.store.id} FOR UPDATE`;
    if (!row) throw new OrderError("not_found", "Η παραγγελία δεν βρέθηκε.");
    const o = await tx.order.findUniqueOrThrow({ where: { id }, select: { status: true, delivery: true, payment: true, billId: true, customerName: true, source: true, lines: true } });
    if (!canMove(o.status as OrderStatus, input.to, o.delivery)) throw new OrderError("bad_move", "Η παραγγελία δεν μπορεί να πάει σε αυτή την κατάσταση.");
    if ((input.to === "REJECTED" || input.to === "CANCELLED") && !input.reason) throw new OrderError("invalid", "Γράψε τον λόγο.");
    const data: Prisma.OrderUpdateInput = { status: input.to };
    if (input.to === "ACCEPTED") {
      data.readyAt = new Date(now.getTime() + (input.readyInMin ?? 20) * 60_000);
      if (o.payment !== "PLATFORM" && !o.billId) {
        const known = o.lines.filter((l) => l.productId);
        const lines: PricedLine[] = known.map((l) => ({ productId: l.productId!, name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: 0, options: (l.options as PricedLine["options"]) ?? undefined, note: l.note ?? undefined }));
        // ο ΦΠΑ από το προϊόν του καταλόγου· τα είδη χωρίς αντιστοίχιση δεν μπαίνουν στον λογαριασμό
        const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, orgId: ctx.org.id }, select: { id: true, vatRate: { select: { rate: true } } } });
        for (const l of lines) l.vatRate = products.find((p) => p.id === l.productId)?.vatRate.rate ?? 0;
        if (lines.length) data.bill = { connect: { id: await billFor(tx, ctx, `${o.source === "WOLT" ? "Wolt" : "efood"} · ${o.customerName}`.slice(0, 60), lines, byName) } };
      }
    }
    if (input.to === "REJECTED" || input.to === "CANCELLED") {
      data.rejectReason = input.reason;
      if (o.billId) {
        const paid = await tx.sale.count({ where: { billId: o.billId, status: "COMPLETED" } }) + await tx.billShare.count({ where: { billId: o.billId, status: "PAID" } });
        if (paid) throw new OrderError("bad_move", "Η παραγγελία έχει πληρωθεί: κάνε πρώτα επιστροφή από τις Συναλλαγές.");
        await tx.bill.update({ where: { id: o.billId }, data: { status: "CANCELLED", closedAt: now } });
      }
    }
    await tx.order.update({ where: { id }, data });
    return { id, status: input.to };
  });
}

/** Για το γράφημα της κονσόλας: κλήσεις της ημέρας ανά ώρα, απαντημένες και αναπάντητες. */
export async function callsToday(orgId: string, start: Date, end: Date) {
  const rows = await db.call.findMany({ where: { orgId, startedAt: { gte: start, lt: end } }, select: { startedAt: true, state: true, orderId: true } });
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, answered: 0, missed: 0 }));
  // κλήση που χτυπά πάνω από 3′ χωρίς απάντηση ή τέλος (χαμένο γεγονός, δοκιμαστική) μετρά αναπάντητη· όσες χτυπούν τώρα δεν μετρούν ακόμα
  const stale = Date.now() - 3 * 60_000;
  const missed = (r: (typeof rows)[number]) => !r.orderId && (r.state === "MISSED" || (r.state === "RINGING" && r.startedAt.getTime() < stale));
  let missedCount = 0;
  for (const r of rows) {
    const h = Number(r.startedAt.toLocaleString("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }));
    if (missed(r)) { hours[h].missed++; missedCount++; } else if (r.state !== "RINGING" || r.orderId) hours[h].answered++;
  }
  return { hours, total: rows.length, missed: missedCount, orders: rows.filter((r) => r.orderId).length };
}


export const orderErrorResponse = (e: unknown) =>
  e instanceof OrderError ? Response.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : e.code === "invalid" ? 400 : 409 }) : null;
