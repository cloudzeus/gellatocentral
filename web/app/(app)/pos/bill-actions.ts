"use server";

// Τραπέζια και ανοιχτοί λογαριασμοί για το ταμείο του browser: ίδια λογική με τα /api/pos/bills/* του Android,
// με τον χρήστη του browser στη θέση της βάρδιας της συσκευής.
import { after } from "next/server";
import { z } from "zod";
import { addRound, askBill, billDetail, BillError, cancelBill, draftSettlement, fireRound, markServed, openBill, soldOutIds, storeBills, voidLine } from "@/lib/bills";
import { signOrderSlips } from "@/lib/order-slips";
import { failShare, issueSale, PosError, startShare } from "@/lib/pos";
import { cartLines, priceCart } from "@/lib/pos-cart";
import { ModifierError } from "@/lib/pos-modifiers";
import { sendToTerminal } from "@/lib/pos-till";
import { currentContext } from "@/lib/tenant";
import { vivaConfigured } from "@/lib/viva/cloud-terminal";

const id = z.string().cuid();
const methodId = z.string().min(1).max(40); // τα seeded id είναι «pm_cash»…, όχι cuid

type Fail = { error: string };
/** Γνωστές αποτυχίες → μήνυμα για τον ταμία· ό,τι άλλο είναι σφάλμα του server. */
async function guard<T>(f: () => Promise<T>): Promise<T | Fail> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof BillError || e instanceof PosError || e instanceof ModifierError) return { error: e.message };
    throw e;
  }
}
const slips = (ctx: Awaited<ReturnType<typeof currentContext>>, ids: string[]) => after(() => signOrderSlips(ctx.org.id, ctx.issuer.vivaMerchantId ?? null, ids));

/** Κάτοψη: τραπέζια, ανοιχτοί λογαριασμοί και όσα τελείωσαν. */
export async function loadFloor() {
  return storeBills(await currentContext());
}

export async function loadBill(billId: string) {
  return billDetail(await currentContext(), id.parse(billId));
}

/** Νέος λογαριασμός σε τραπέζι· αν είναι ήδη ανοιχτό, ο υπάρχων. */
export async function openTable(tableId: string) {
  const ctx = await currentContext();
  return guard(() => openBill(ctx, { tableId: id.parse(tableId), byName: ctx.user.name }));
}

/** Νέος γύρος στον λογαριασμό. held = «Μετά»: γράφεται χωρίς να πάει στην κουζίνα ως το «Βγάλ' το». */
export async function sendRound(billId: string, lines: unknown, held: boolean) {
  const ctx = await currentContext();
  const parsed = cartLines.safeParse(lines);
  if (!parsed.success) return { error: "Η παραγγελία δεν διαβάστηκε. Ανανέωσε τη σελίδα" };
  return guard(async () => {
    const out = new Set(await soldOutIds(ctx));
    if (parsed.data.some((l) => out.has(l.productId) || l.options.some((o) => out.has(o)))) throw new BillError("sold_out", "Κάτι από την παραγγελία τελείωσε στο μεταξύ. Βγάλ' το και στείλε ξανά");
    const priced = await priceCart(ctx.org.id, parsed.data);
    if (!priced) return { error: "Κάποιο προϊόν δεν υπάρχει πια στον κατάλογο. Ανανέωσε τη σελίδα" };
    const round = await addRound(ctx, id.parse(billId), priced, ctx.user.name, held);
    slips(ctx, round.slipIds); // 8.6: η κουζίνα δεν περιμένει τη Viva
    return { number: round.number };
  });
}

export async function fire(billId: string, roundId: string) {
  const ctx = await currentContext();
  return guard(async () => { slips(ctx, (await fireRound(ctx, id.parse(billId), id.parse(roundId), ctx.user.name)).slipIds); return { ok: true }; });
}

export async function served(billId: string, lineIds: string[], value: boolean) {
  const ctx = await currentContext();
  return guard(() => markServed(ctx, id.parse(billId), z.array(id).min(1).max(100).parse(lineIds), value));
}

export async function unask(billId: string) {
  const ctx = await currentContext();
  return guard(() => askBill(ctx, id.parse(billId), false));
}

export async function voidBillLine(billId: string, lineId: string, reason: string) {
  const ctx = await currentContext();
  return guard(async () => { slips(ctx, await voidLine(ctx, id.parse(billId), id.parse(lineId), z.string().trim().min(1).max(120).parse(reason))); return { ok: true }; });
}

/** Κλείσιμο λογαριασμού χωρίς πληρωμή (π.χ. άνοιξε κατά λάθος). */
export async function closeEmpty(billId: string) {
  const ctx = await currentContext();
  return guard(async () => { slips(ctx, await cancelBill(ctx, id.parse(billId), "Χωρίς παραγγελία")); return { ok: true }; });
}

export type PayStart = Fail | { pending: string } | { paid: { saleId?: string; share?: boolean } };

async function terminalReady(ctx: Awaited<ReturnType<typeof currentContext>>) {
  const live = await vivaConfigured();
  if (live && !(ctx.issuer.vivaMerchantId && ctx.device.vivaTerminalId)) throw new PosError("method_unavailable", "Αυτό το ταμείο δεν έχει τερματικό Viva. Όρισέ του τερματικό στο Συσκευές.");
  return live;
}

/** Απόδειξη για ό,τι μένει ή για τα είδη που διάλεξε ο πελάτης (lines). Με την τελευταία ο λογαριασμός κλείνει μόνος του. */
export async function settle(billId: string, method: string, lines?: { lineId: string; quantity: number }[]): Promise<PayStart> {
  const ctx = await currentContext();
  const pick = lines ? z.array(z.object({ lineId: id, quantity: z.number().int().min(1).max(999) })).min(1).max(100).parse(lines) : undefined;
  return guard(async () => {
    const live = await terminalReady(ctx);
    const sale = await draftSettlement(ctx, id.parse(billId), pick);
    const started = await issueSale(ctx, sale.id, methodId.parse(method), live);
    if (!started) return { error: "Δεν μένει κάτι να πληρωθεί" };
    if (!live) return { paid: { saleId: started.saleId } };
    const failed = await sendToTerminal(ctx, started);
    if (failed) return { error: ((await failed.json()) as { message?: string }).message ?? "Η χρέωση δεν έφτασε στο τερματικό" };
    return { pending: started.saleId };
  });
}

/** Μοίρασμα κατά ποσό: ένα μερίδιο πριν από την απόδειξη. Μετρητά = καταγράφεται αμέσως· κάρτα = στο τερματικό. */
export async function payShare(billId: string, method: string, amountCents: number): Promise<PayStart> {
  const ctx = await currentContext();
  return guard(async () => {
    const live = await terminalReady(ctx);
    const r = await startShare(ctx, id.parse(billId), methodId.parse(method), z.number().int().min(1).max(10_000_000).parse(amountCents), live);
    if (!r.start) return { paid: { share: true } };
    const failed = await sendToTerminal(ctx, r.start, (message) => failShare(ctx.device.id, r.share.id, { error: message }, ctx.org.id));
    if (failed) return { error: ((await failed.json()) as { message?: string }).message ?? "Η χρέωση δεν έφτασε στο τερματικό" };
    return { pending: r.share.id };
  });
}
