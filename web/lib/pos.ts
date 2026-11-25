// Έκδοση απόδειξης: κοινή λογική για το ταμείο του browser (server actions) και την εφαρμογή Android (API).
import { randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { tenantWriteTransaction } from "./migration-cutover";
import { buildReceipt, toVivaJson } from "./viva/fiscal";

/** Αποτυχία έκδοσης με γνωστή αιτία: το API του ταμείου τη στέλνει στη συσκευή με τον κωδικό της. */
export class PosError extends Error {
  constructor(readonly code: "busy" | "method_unavailable", message: string) {
    super(message);
    this.name = "PosError";
  }
}

type Ctx = { org: { id: string; vatNumber: string }; device: { id: string; series: string } };

/**
 * Κλειδώνει τη συσκευή, δίνει ΑΑ και γράφει πληρωμή + παραστατικό.
 * `live` = η πληρωμή/σήμανση θα γίνει στη Viva· ο ΑΑ «καίγεται» μόνο στο completeSale.
 * Αλλιώς (δοκιμαστική λειτουργία) η πώληση ολοκληρώνεται αμέσως, χωρίς διαβίβαση.
 */
export async function issueSale(ctx: Ctx, saleId: string, methodId: string, live: boolean) {
  return tenantWriteTransaction(ctx.org.id, async (tx) => {
    // Κλείδωμα της συσκευής: δύο ταυτόχρονες πληρωμές δεν πρέπει να πάρουν τον ίδιο ΑΑ.
    const [{ nextAa }] = await tx.$queryRaw<{ nextAa: number }[]>`SELECT "nextAa" FROM "Device" WHERE id = ${ctx.device.id} FOR UPDATE`;
    if (await tx.sale.findFirst({ where: { deviceId: ctx.device.id, status: "AWAITING_PAYMENT" } }))
      throw new PosError("busy", "Υπάρχει ήδη πληρωμή σε εξέλιξη σε αυτό το ταμείο.");
    const sale = await tx.sale.findFirst({ where: { id: saleId, orgId: ctx.org.id, deviceId: ctx.device.id, status: "DRAFT" }, include: { lines: { orderBy: { id: "asc" } } } }); // σταθερή σειρά: η ίδια απόδειξη ξαναχτίζεται στο pendingSale
    if (!sale || sale.lines.length === 0) return null;

    // Ο τρόπος πληρωμής από την κοινή λίστα: μόνο ενεργός, για ταμείο, με φορολογική αντιστοίχιση
    const method = await tx.paymentMethod.findFirst({ where: { id: methodId, active: true, posEnabled: true } });
    if (!method?.payItemCase) throw new PosError("method_unavailable", "Ο τρόπος πληρωμής δεν είναι διαθέσιμος στο ταμείο.");

    const reference = randomUUID(); // νέο σε κάθε προσπάθεια: η Viva επιστρέφει το παλιό αποτέλεσμα σε ίδιο sessionId
    const issuedAt = new Date();
    const receipt = buildReceipt({
      merchantVat: ctx.org.vatNumber,
      series: ctx.device.series,
      aa: nextAa,
      reference,
      moment: issuedAt,
      payItem: { description: method.name, payItemCase: method.payItemCase },
      lines: sale.lines,
    });

    // προηγούμενη αποτυχημένη προσπάθεια της ίδιας πώλησης
    await tx.payment.deleteMany({ where: { saleId: sale.id } });
    await tx.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
    await tx.payment.create({ data: { saleId: sale.id, methodId: method.id, amountCents: receipt.totalCents, vivaSessionId: live ? reference : null, success: !live } });
    await tx.fiscalDocument.create({ data: { saleId: sale.id, orgId: ctx.org.id, receiptReference: reference, status: live ? "PENDING" : "NOT_SENT", request: JSON.parse(toVivaJson(receipt.data)) } });
    await tx.sale.update({
      where: { id: sale.id },
      data: { status: live ? "AWAITING_PAYMENT" : "COMPLETED", totalCents: receipt.totalCents, series: ctx.device.series, aa: nextAa, issuedAt },
    });
    if (!live) await tx.device.update({ where: { id: ctx.device.id }, data: { nextAa: { increment: 1 } } });
    return { saleId: sale.id, reference, receipt };
  });
}

/**
 * Η πώληση της συσκευής που περιμένει πληρωμή, με ό,τι χρειάζεται η εφαρμογή για να ξανανοίξει το Viva Terminal.
 * Η απόδειξη ξαναχτίζεται από τα αποθηκευμένα στοιχεία (ίδιος ΑΑ, ίδιο reference, ίδια ώρα): το αποθηκευμένο JSON του
 * αιτήματος δεν κάνει, γιατί οι 64-bit κωδικοί της σήμανσης χάνουν ακρίβεια όταν περάσουν από JSON.parse.
 */
export async function pendingSale(db: Pick<Prisma.TransactionClient, "sale">, ctx: Ctx) {
  const sale = await db.sale.findFirst({
    where: { orgId: ctx.org.id, deviceId: ctx.device.id, status: "AWAITING_PAYMENT" },
    include: { lines: { orderBy: { id: "asc" } }, payment: { include: { method: true } } },
  });
  const method = sale?.payment?.method;
  if (!sale || !sale.aa || !sale.issuedAt || !sale.payment?.vivaSessionId || !method?.payItemCase) return null;
  const receipt = buildReceipt({
    merchantVat: ctx.org.vatNumber, series: ctx.device.series, aa: sale.aa, reference: sale.payment.vivaSessionId, moment: sale.issuedAt,
    payItem: { description: method.name, payItemCase: method.payItemCase }, lines: sale.lines,
  });
  return { saleId: sale.id, reference: sale.payment.vivaSessionId, receipt, methodId: method.id, methodName: method.name, issuedAt: sale.issuedAt };
}

/** Η Viva επιβεβαίωσε πληρωμή και σήμανση. Το settlement επιτρέπεται και κατά το freeze. */
export async function completeSale(deviceId: string, saleId: string, raw: Prisma.InputJsonValue, transactionId: string | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, orgId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "COMPLETED" } });
    if (count === 0) return;
    await tx.payment.update({ where: { saleId }, data: { success: true, vivaTransactionId: transactionId, raw } });
    // shortcut: όλη η απάντηση φυλάσσεται ως έχει· τα πεδία σήμανσης (ftSignatures/QR) θα χαρτογραφηθούν
    // σε στήλες μόλις δούμε πραγματική απάντηση από το demo της Viva.
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "SIGNED", response: raw } });
    await tx.device.update({ where: { id: deviceId }, data: { nextAa: { increment: 1 } } });
  }, { purpose: "SETTLEMENT" });
}

/** Η πληρωμή δεν έγινε: η πώληση γυρίζει σε πρόχειρο και ο ΑΑ μένει ελεύθερος για την επόμενη. */
export async function failSale(deviceId: string, saleId: string, error: string, raw: Prisma.InputJsonValue | undefined, orgId: string) {
  await tenantWriteTransaction(orgId, async (tx) => {
    const { count } = await tx.sale.updateMany({ where: { id: saleId, orgId, deviceId, status: "AWAITING_PAYMENT" }, data: { status: "DRAFT", series: null, aa: null, issuedAt: null } });
    if (count === 0) return;
    await tx.fiscalDocument.update({ where: { saleId }, data: { status: "FAILED", error } });
    await tx.payment.update({ where: { saleId }, data: { success: false, raw } });
  }, { purpose: "SETTLEMENT" });
}
