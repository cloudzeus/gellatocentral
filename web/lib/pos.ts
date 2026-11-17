// Έκδοση απόδειξης: κοινή λογική για το ταμείο του browser (server actions) και την εφαρμογή Android (API).
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { buildReceipt, toVivaJson } from "./viva/fiscal";

type Ctx = { org: { id: string; vatNumber: string }; device: { id: string; series: string } };

/**
 * Κλειδώνει τη συσκευή, δίνει ΑΑ και γράφει πληρωμή + παραστατικό.
 * `live` = η πληρωμή/σήμανση θα γίνει στη Viva· ο ΑΑ «καίγεται» μόνο στο completeSale.
 * Αλλιώς (δοκιμαστική λειτουργία) η πώληση ολοκληρώνεται αμέσως, χωρίς διαβίβαση.
 */
export async function issueSale(ctx: Ctx, saleId: string, method: "CASH" | "CARD", live: boolean) {
  return db.$transaction(async (tx) => {
    // Κλείδωμα της συσκευής: δύο ταυτόχρονες πληρωμές δεν πρέπει να πάρουν τον ίδιο ΑΑ.
    const [{ nextAa }] = await tx.$queryRaw<{ nextAa: number }[]>`SELECT "nextAa" FROM "Device" WHERE id = ${ctx.device.id} FOR UPDATE`;
    if (await tx.sale.findFirst({ where: { deviceId: ctx.device.id, status: "AWAITING_PAYMENT" } }))
      throw new Error("Υπάρχει ήδη πληρωμή σε εξέλιξη σε αυτό το ταμείο.");
    const sale = await tx.sale.findFirst({ where: { id: saleId, deviceId: ctx.device.id, status: "DRAFT" }, include: { lines: true } });
    if (!sale || sale.lines.length === 0) return null;

    const reference = randomUUID(); // νέο σε κάθε προσπάθεια: η Viva επιστρέφει το παλιό αποτέλεσμα σε ίδιο sessionId
    const issuedAt = new Date();
    const receipt = buildReceipt({ merchantVat: ctx.org.vatNumber, series: ctx.device.series, aa: nextAa, reference, moment: issuedAt, method, lines: sale.lines });

    // προηγούμενη αποτυχημένη προσπάθεια της ίδιας πώλησης
    await tx.payment.deleteMany({ where: { saleId: sale.id } });
    await tx.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
    await tx.payment.create({ data: { saleId: sale.id, method, amountCents: receipt.totalCents, vivaSessionId: live ? reference : null, success: !live } });
    await tx.fiscalDocument.create({ data: { saleId: sale.id, receiptReference: reference, status: live ? "PENDING" : "NOT_SENT", request: JSON.parse(toVivaJson(receipt.data)) } });
    await tx.sale.update({
      where: { id: sale.id },
      data: { status: live ? "AWAITING_PAYMENT" : "COMPLETED", totalCents: receipt.totalCents, series: ctx.device.series, aa: nextAa, issuedAt },
    });
    if (!live) await tx.device.update({ where: { id: ctx.device.id }, data: { nextAa: { increment: 1 } } });
    return { saleId: sale.id, reference, receipt };
  });
}

/** Η Viva επιβεβαίωσε πληρωμή και σήμανση. Αν κληθεί δύο φορές, μόνο η πρώτη αυξάνει τον ΑΑ. */
export async function completeSale(deviceId: string, saleId: string, raw: Prisma.InputJsonValue, transactionId?: string) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "COMPLETED" } });
    if (count === 0) return;
    await tx.payment.update({ where: { saleId }, data: { success: true, vivaTransactionId: transactionId, raw } });
    // shortcut: όλη η απάντηση φυλάσσεται ως έχει· τα πεδία σήμανσης (ftSignatures/QR) θα χαρτογραφηθούν
    // σε στήλες μόλις δούμε πραγματική απάντηση από το demo της Viva.
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "SIGNED", response: raw } });
    await tx.device.update({ where: { id: deviceId }, data: { nextAa: { increment: 1 } } });
  });
}

/** Η πληρωμή δεν έγινε: η πώληση γυρίζει σε πρόχειρο και ο ΑΑ μένει ελεύθερος για την επόμενη. */
export async function failSale(deviceId: string, saleId: string, error: string, raw?: Prisma.InputJsonValue) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "DRAFT", series: null, aa: null, issuedAt: null } });
    if (count === 0) return;
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "FAILED", error } });
    await tx.payment.update({ where: { saleId }, data: { success: false, raw } });
  });
}
