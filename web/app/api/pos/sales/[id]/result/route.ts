import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import type { Prisma } from "@/lib/generated/prisma/client";
import { accessFor } from "@/lib/plan-data";
import { completeSale, completeShare, failSale, failShare } from "@/lib/pos";
import { cancelBrowserPayment, syncBrowserPayment } from "@/lib/viva/browser-payment";
import { abortSession, verifySaleSession } from "@/lib/viva/cloud-terminal";

const body = z.object({ success: z.boolean(), transactionId: z.string().max(100).optional(), callback: z.string().max(8000) });

type Till = NonNullable<Awaited<ReturnType<typeof tillFromRequest>>>;

async function loadSale(ctx: Till, id: string) {
  const sale = await db.sale.findFirst({
    where: { id, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id },
    select: {
      id: true, orgId: true, storeId: true, deviceId: true, status: true, totalCents: true, series: true, aa: true,
      payment: { select: { amountCents: true, vivaSessionId: true } },
      shares: { select: { amountCents: true } },
    },
  });
  // Μοίρασμα κατά ποσό: το τερματικό χρέωσε μόνο ό,τι έμενε πέρα από τα μερίδια
  return sale && { ...sale, totalCents: sale.totalCents - sale.shares.reduce((t, x) => t + x.amountCents, 0) };
}

/**
 * Μερίδιο λογαριασμού (μοίρασμα κατά ποσό): η εφαρμογή το αναφέρει στο ίδιο endpoint με το id του. Ίδιοι κανόνες
 * με την πώληση: η επιτυχία μετράει μόνο αφού η Viva βεβαιώσει τη συνεδρία· όταν η Viva λέει «πέρασε», μετράει η Viva.
 */
async function loadShare(ctx: Till, id: string) {
  const share = await db.billShare.findFirst({ where: { id, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id } });
  if (!share) return null;
  // ως «πώληση» για τον έλεγχο της Viva: merchantReference = id, sessionId = reference, ποσό = το μερίδιο
  const asSale = { id: share.id, orgId: share.orgId, storeId: share.storeId, deviceId: share.deviceId, totalCents: share.amountCents, payment: { amountCents: share.amountCents, vivaSessionId: share.reference } };
  return { share, asSale, status: share.status === "PENDING" ? "AWAITING_PAYMENT" as const : share.status === "PAID" ? "COMPLETED" as const : "DRAFT" as const };
}
const shareDone = () => Response.json({ ok: true, series: null, aa: null });

async function postShare(ctx: Till, s: NonNullable<Awaited<ReturnType<typeof loadShare>>>, r: z.infer<typeof body>) {
  if (s.status === "COMPLETED") return shareDone();
  if (s.status !== "AWAITING_PAYMENT") return r.success ? Response.json({ error: "invalid_state" }, { status: 409 }) : Response.json({ ok: true });
  if (!r.success && ctx.device.vivaCloud) {
    const c = await cancelBrowserPayment({ ...s.asSale, status: "AWAITING_PAYMENT" }, terminalOf(ctx), {
      complete: (raw, transactionId) => completeShare(ctx.device.id, s.share.id, raw, transactionId, ctx.org.id),
      fail: (_reason, raw) => failShare(ctx.device.id, s.share.id, raw, ctx.org.id),
    }, abortSession);
    if (c.status === "completed") return shareDone();
    if (c.status === "cancelled") return Response.json({ ok: true });
    if (c.status === "aborting") return Response.json({ pending: true }, { status: 202 });
    return Response.json({ error: "viva_unavailable" }, { status: 502 });
  }
  if (!r.success) {
    const v = await verifySaleSession(s.asSale, terminalOf(ctx)).catch(() => null);
    if (v?.status === "verified") { await completeShare(ctx.device.id, s.share.id, v.raw as Prisma.InputJsonObject, v.transactionId, ctx.org.id); return shareDone(); }
    await failShare(ctx.device.id, s.share.id, { callback: r.callback }, ctx.org.id);
    return Response.json({ ok: true });
  }
  let v: Awaited<ReturnType<typeof verifySaleSession>>;
  try { v = await verifySaleSession(s.asSale, terminalOf(ctx), r.transactionId); } catch { return Response.json({ error: "viva_unavailable" }, { status: 502 }); }
  if (v.status === "pending") return Response.json({ pending: true }, { status: 202 });
  if (v.status === "rejected") return Response.json({ error: "verification_failed", reason: v.reason }, { status: 409 });
  await completeShare(ctx.device.id, s.share.id, v.raw as Prisma.InputJsonObject, v.transactionId, ctx.org.id);
  return shareDone();
}
const terminalOf = (ctx: Till) => ({ orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, terminalId: ctx.device.vivaTerminalId });
/** Η απάντηση επιτυχίας: μαζί ο αριθμός της απόδειξης, για να τον δείξει το ταμείο. */
const done = (sale: { series: string | null; aa: number | null }) => Response.json({ ok: true, series: sale.series, aa: sale.aa });

/**
 * Αναστολή, απλήρωτη συνδρομή ή παύση κλείνουν το ταμείο για ΝΕΕΣ πωλήσεις. Μια πώληση που ήδη περιμένει πληρωμή
 * πρέπει να μπορεί να κλείσει: αλλιώς ο πελάτης έχει χρεωθεί και η απόδειξη δεν ολοκληρώνεται ποτέ.
 */
async function closedFor(ctx: Till, status: string) {
  if (status === "AWAITING_PAYMENT" || status === "COMPLETED") return false;
  return !(await accessFor(ctx.org.id, [ctx.device.storeId])).open.includes("pos");
}

// Η εφαρμογή αναφέρει το callback του Viva Terminal. Η επιτυχία ολοκληρώνεται μόνο αφού
// ο server ανακτήσει και διασταυρώσει τη συνεδρία· το callback δεν αποτελεί απόδειξη πληρωμής.
export async function POST(req: Request, { params }: RouteContext<"/api/pos/sales/[id]/result">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const id = (await params).id;
  const sale = await loadSale(ctx, id);
  if (!sale) {
    const share = await loadShare(ctx, id);
    if (!share) return Response.json({ error: "not_found" }, { status: 404 });
    if (await closedFor(ctx, share.status)) return Response.json({ error: "paused" }, { status: 403 });
    return postShare(ctx, share, parsed.data);
  }
  if (await closedFor(ctx, sale.status)) return Response.json({ error: "paused" }, { status: 403 });

  if (!parsed.data.success) {
    // Επανάληψη της ίδιας δήλωσης αφού η πώληση έκλεισε ως πληρωμένη (χάθηκε η πρώτη απάντηση): η απάντηση πρέπει να
    // λέει ξανά «πληρώθηκε». Αλλιώς η συσκευή θα έδειχνε «ο πελάτης δεν χρεώθηκε» και ο ταμίας θα χρέωνε δεύτερη φορά.
    if (sale.status === "COMPLETED") return done(sale);
    // Τερματικό σε άλλη συσκευή: η χρέωση περιμένει εκεί, οπότε πρώτα σταματά (Abort Session), όπως στο ταμείο του browser.
    if (ctx.device.vivaCloud && sale.status === "AWAITING_PAYMENT") {
      const r = await cancelBrowserPayment({ ...sale, status: "AWAITING_PAYMENT" }, terminalOf(ctx), {
        complete: (raw, transactionId) => completeSale(ctx.device.id, sale.id, raw, transactionId, ctx.org.id),
        fail: (reason, raw) => failSale(ctx.device.id, sale.id, reason, raw, ctx.org.id),
      }, abortSession);
      if (r.status === "completed") return done(sale);
      if (r.status === "cancelled") return Response.json({ ok: true });
      if (r.status === "aborting") return Response.json({ pending: true }, { status: 202 });
      return Response.json({ error: "viva_unavailable" }, { status: 502 });
    }
    // Η συσκευή λέει «δεν έγινε». Αν όμως η Viva βεβαιώνει ότι η πληρωμή πέρασε, μετράει η Viva: αλλιώς ο πελάτης
    // θα είχε χρεωθεί και η πώληση θα γύριζε σε πρόχειρο. Αν η Viva δεν απαντά, ισχύει η δήλωση της συσκευής, όπως πριν.
    const verification = sale.status === "AWAITING_PAYMENT" ? await verifySaleSession(sale, terminalOf(ctx)).catch(() => null) : null;
    if (verification?.status === "verified") {
      await completeSale(ctx.device.id, sale.id, verification.raw as Prisma.InputJsonObject, verification.transactionId, ctx.org.id);
      return done(sale);
    }
    await failSale(ctx.device.id, sale.id, "Η πληρωμή δεν ολοκληρώθηκε στο τερματικό", { callback: parsed.data.callback }, ctx.org.id);
    return Response.json({ ok: true });
  }
  if (sale.status !== "AWAITING_PAYMENT" && sale.status !== "COMPLETED")
    return Response.json({ error: "invalid_state" }, { status: 409 });

  let verification: Awaited<ReturnType<typeof verifySaleSession>>;
  try {
    verification = await verifySaleSession(sale, terminalOf(ctx), parsed.data.transactionId);
  } catch {
    // Σφάλμα δικτύου/provider: η πώληση μένει σε αναμονή για νέα προσπάθεια.
    return Response.json({ error: "viva_unavailable" }, { status: 502 });
  }
  if (verification.status === "pending") return Response.json({ pending: true }, { status: 202 });
  if (verification.status === "rejected")
    return Response.json({ error: "verification_failed", reason: verification.reason }, { status: 409 });

  // Το completeSale είναι idempotent· αποθηκεύουμε αποκλειστικά την επαληθευμένη απάντηση του provider.
  await completeSale(ctx.device.id, sale.id, verification.raw as Prisma.InputJsonObject, verification.transactionId, ctx.org.id);
  return done(sale);
}

/**
 * «Έλεγξε αν πληρώθηκε»: για πώληση που έμεινε στη μέση χωρίς callback (η εφαρμογή έκλεισε, χάθηκε το δίκτυο).
 * Ρωτά τη Viva με τη συνεδρία της πώλησης, όπως το ταμείο του browser. Ασφαλές να κληθεί ξανά και ξανά.
 * Απαντά { status: completed | pending | failed | rejected | error }.
 */
export async function GET(req: Request, { params }: RouteContext<"/api/pos/sales/[id]/result">) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = (await params).id;
  const sale = await loadSale(ctx, id);
  if (!sale) {
    const s = await loadShare(ctx, id);
    if (!s) return Response.json({ error: "not_found" }, { status: 404 });
    if (s.status === "COMPLETED") return Response.json({ status: "completed", series: null, aa: null });
    if (s.status !== "AWAITING_PAYMENT") return Response.json({ status: "failed" });
    const result = await syncBrowserPayment({ ...s.asSale, status: "AWAITING_PAYMENT" }, terminalOf(ctx), {
      complete: (raw, transactionId) => completeShare(ctx.device.id, s.share.id, raw, transactionId, ctx.org.id),
      fail: (_reason, raw) => failShare(ctx.device.id, s.share.id, raw, ctx.org.id),
    });
    return Response.json(result, { status: result.status === "error" ? 502 : 200 });
  }
  if (sale.status === "COMPLETED") return Response.json({ status: "completed", series: sale.series, aa: sale.aa });
  // γύρισε ήδη σε πρόχειρο (η πληρωμή δεν έγινε) ή ακυρώθηκε
  if (sale.status !== "AWAITING_PAYMENT") return Response.json({ status: "failed" });
  const result = await syncBrowserPayment({ ...sale, status: "AWAITING_PAYMENT" }, terminalOf(ctx), {
    complete: (raw, transactionId) => completeSale(ctx.device.id, sale.id, raw, transactionId, ctx.org.id),
    fail: (reason, raw) => failSale(ctx.device.id, sale.id, reason, raw, ctx.org.id),
  });
  return Response.json(result.status === "completed" ? { ...result, series: sale.series, aa: sale.aa } : result, { status: result.status === "error" ? 502 : 200 });
}
