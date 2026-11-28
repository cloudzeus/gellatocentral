// Πωλήσεις που έκανε το ταμείο Android χωρίς σύνδεση με τον server. Η συσκευή έχτισε η ίδια την απόδειξη (ίδιο
// buildReceipt, σειρά της συσκευής, δικός της ΑΑ) και την έδωσε στο Viva Terminal, που υπογράφει και διαβιβάζει
// (ή κρατά και ξαναστέλνει μόνο του όταν λείπει το internet). Εδώ η πώληση απλώς καταγράφεται όταν γυρίσει η σύνδεση,
// και μόνο αφού η Viva βεβαιώσει την πληρωμή, όπως στις κανονικές πωλήσεις: τίποτα δεν γράφεται μισό.
import { z } from "zod";
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { consumeSaleSafely } from "./consumption";
import { tenantWriteTransaction } from "./migration-cutover";
import { lineDescription } from "./pos-modifiers";
import { verifySaleSession } from "./viva/cloud-terminal";
import { buildReceipt, toStoredJson } from "./viva/fiscal";
import { terminalFiscal, transmissionNote } from "./viva/sign";

export const offlineSale = z.object({
  saleId: z.string().min(10).max(40), // clientTransactionId του Viva Terminal
  reference: z.string().uuid(), // cbReceiptReference = sessionId
  aa: z.number().int().min(1).max(999_999_999),
  issuedAt: z.string().datetime(),
  methodId: z.string().min(1).max(40),
  amountCents: z.number().int().min(1),
  transactionId: z.string().max(100).optional(),
  // ό,τι χρέωσε η συσκευή από τον κατάλογο που είχε: η τιμή της στιγμής μετράει, όχι η σημερινή
  lines: z.array(z.object({
    productId: z.string().cuid(), name: z.string().min(1).max(200), quantity: z.number().int().min(1).max(999),
    unitPriceCents: z.number().int().min(0), vatRate: z.number().int().min(0).max(100),
    options: z.array(z.object({ name: z.string().max(200), priceCents: z.number().int() })).max(20).default([]),
    note: z.string().trim().max(80).optional(),
  })).min(1).max(100),
});
export type OfflineSale = z.infer<typeof offlineSale>;

type Till = { org: { id: string }; store: { id: string }; device: { id: string; series: string; vivaTerminalId: string | null }; issuer: { vatNumber: string } };
export type OfflineOutcome = { state: "done"; series: string; aa: number } | { state: "pending" } | { state: "rejected"; reason: string };

export async function recordOfflineSale(ctx: Till, input: OfflineSale, verify = verifySaleSession): Promise<OfflineOutcome> {
  const existing = await db.sale.findFirst({ where: { id: input.saleId, deviceId: ctx.device.id }, select: { status: true, series: true, aa: true } });
  if (existing) return existing.status === "COMPLETED" ? { state: "done", series: existing.series!, aa: existing.aa! } : { state: "rejected", reason: "exists" };
  const method = await db.paymentMethod.findFirst({ where: { id: input.methodId, active: true, posEnabled: true, payItemCase: { not: null } } });
  if (!method) return { state: "rejected", reason: "method" };
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  if ((await db.product.count({ where: { orgId: ctx.org.id, id: { in: ids } } })) !== ids.length) return { state: "rejected", reason: "product" };

  const issuedAt = new Date(input.issuedAt);
  const receipt = buildReceipt({
    merchantVat: ctx.issuer.vatNumber, series: ctx.device.series, aa: input.aa, reference: input.reference, moment: issuedAt,
    payItem: { description: method.name, payItemCase: method.payItemCase! },
    lines: input.lines.map((l) => ({ name: lineDescription(l), quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate })),
  });
  if (receipt.totalCents !== input.amountCents) return { state: "rejected", reason: "amount" };

  const sale = { id: input.saleId, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, totalCents: receipt.totalCents, payment: { amountCents: input.amountCents, vivaSessionId: input.reference } };
  const v = await verify(sale, { orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, terminalId: ctx.device.vivaTerminalId }, input.transactionId);
  if (v.status === "pending") return { state: "pending" };
  if (v.status === "rejected") return { state: "rejected", reason: v.reason };

  const raw = v.raw as Prisma.InputJsonValue;
  try {
  await tenantWriteTransaction(ctx.org.id, async (tx) => {
    await tx.sale.create({
      data: {
        id: input.saleId, orgId: ctx.org.id, storeId: ctx.store.id, deviceId: ctx.device.id, status: "COMPLETED", totalCents: receipt.totalCents,
        series: ctx.device.series, aa: input.aa, issuedAt,
        lines: { create: input.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate, options: l.options.length ? l.options : undefined, note: l.note || null })) },
        payment: { create: { methodId: method.id, amountCents: input.amountCents, vivaSessionId: input.reference, vivaTransactionId: v.transactionId, success: true, raw } },
        fiscal: { create: { orgId: ctx.org.id, receiptReference: input.reference, aa: input.aa, totalCents: receipt.totalCents, status: "SIGNED", request: toStoredJson(receipt.data) as Prisma.InputJsonValue, response: raw, mark: terminalFiscal(raw).mark ?? null, error: transmissionNote(raw) } },
      },
    });
    // η αρίθμηση της συσκευής συνεχίζει μετά τον μεγαλύτερο ΑΑ που έβγαλε χωρίς σύνδεση
    await tx.$executeRaw`UPDATE "Device" SET "nextAa" = GREATEST("nextAa", ${input.aa + 1}) WHERE id = ${ctx.device.id}`;
    await consumeSaleSafely(tx, { orgId: ctx.org.id, saleId: input.saleId });
  }, { purpose: "SETTLEMENT" });
  } catch (e) {
    // ίδιος ΑΑ με άλλη απόδειξη της συσκευής: θέλει έλεγχο από τον υπεύθυνο, όχι σιωπηλή αλλαγή αριθμού
    if ((e as { code?: string }).code === "P2002") return { state: "rejected", reason: "duplicate_aa" };
    throw e;
  }
  return { state: "done", series: ctx.device.series, aa: input.aa };
}
