import { z } from "zod";
import { db } from "@/lib/db";
import { tillFromRequest } from "@/lib/device-auth";
import type { Prisma } from "@/lib/generated/prisma/client";
import { accessFor } from "@/lib/plan-data";
import { completeSale, failSale } from "@/lib/pos";
import { syncBrowserPayment } from "@/lib/viva/browser-payment";
import { verifySaleSession } from "@/lib/viva/cloud-terminal";

const body = z.object({ success: z.boolean(), transactionId: z.string().max(100).optional(), callback: z.string().max(8000) });

type Till = NonNullable<Awaited<ReturnType<typeof tillFromRequest>>>;

async function loadSale(ctx: Till, id: string) {
  return db.sale.findFirst({
    where: { id, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id },
    select: {
      id: true, orgId: true, storeId: true, deviceId: true, status: true, totalCents: true, series: true, aa: true,
      payment: { select: { amountCents: true, vivaSessionId: true } },
    },
  });
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
  const sale = await loadSale(ctx, (await params).id);
  if (!sale) return Response.json({ error: "not_found" }, { status: 404 });
  if (await closedFor(ctx, sale.status)) return Response.json({ error: "paused" }, { status: 403 });

  if (!parsed.data.success) {
    // Επανάληψη της ίδιας δήλωσης αφού η πώληση έκλεισε ως πληρωμένη (χάθηκε η πρώτη απάντηση): η απάντηση πρέπει να
    // λέει ξανά «πληρώθηκε». Αλλιώς η συσκευή θα έδειχνε «ο πελάτης δεν χρεώθηκε» και ο ταμίας θα χρέωνε δεύτερη φορά.
    if (sale.status === "COMPLETED") return done(sale);
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
  const sale = await loadSale(ctx, (await params).id);
  if (!sale) return Response.json({ error: "not_found" }, { status: 404 });
  if (sale.status === "COMPLETED") return Response.json({ status: "completed", series: sale.series, aa: sale.aa });
  // γύρισε ήδη σε πρόχειρο (η πληρωμή δεν έγινε) ή ακυρώθηκε
  if (sale.status !== "AWAITING_PAYMENT") return Response.json({ status: "failed" });
  const result = await syncBrowserPayment({ ...sale, status: "AWAITING_PAYMENT" }, terminalOf(ctx), {
    complete: (raw, transactionId) => completeSale(ctx.device.id, sale.id, raw, transactionId, ctx.org.id),
    fail: (reason, raw) => failSale(ctx.device.id, sale.id, reason, raw, ctx.org.id),
  });
  return Response.json(result.status === "completed" ? { ...result, series: sale.series, aa: sale.aa } : result, { status: result.status === "error" ? 502 : 200 });
}
