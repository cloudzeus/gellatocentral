// 8.6 Δελτία Παραγγελίας Εστίασης: κάθε αποστολή στο τραπέζι βγάζει ένα, κάθε ακύρωση γραμμής πριν την πληρωμή
// ένα ακυρωτικό 8.6 που δείχνει το αρχικό. Η απόδειξη του λογαριασμού αναφέρει τα 8.6 που εξοφλεί (lib/pos.ts).
// Η έκδοση (ΑΑ, αίτημα) γίνεται μέσα στη συναλλαγή της αποστολής· η υπογραφή στη Viva μετά, χωρίς να κρατά την κουζίνα:
// αν αποτύχει, το 8.6 μένει FAILED και το ξαναστέλνει η επανάληψη διαβιβάσεων.
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { ensureSeries, advanceSeries } from "./documents/series";
import type { Prisma } from "./generated/prisma/client";
import { lineDescription } from "./pos-modifiers";
import { buildOrderSlip, fromStoredJson, toStoredJson, toVivaJson } from "./viva/fiscal";

type Tx = Prisma.TransactionClient;
export type SlipCtx = { org: { id: string }; store: { id: string }; device: { id: string; series: string }; issuer: { vatNumber: string; vivaMerchantId: string | null } };
type SlipLine = { name: string; options: Prisma.JsonValue; note: string | null; quantity: number; unitPriceCents: number; vatRate: number };

const slipLines = (lines: SlipLine[]) => lines.map((l) => ({ name: lineDescription(l), quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: l.vatRate }));

/** Στέλνεται στη Viva μόνο με έμπορο Viva στον εκδότη· αλλιώς (δοκιμαστική λειτουργία) γράφεται χωρίς διαβίβαση. */
const live = (ctx: SlipCtx) => !!ctx.issuer.vivaMerchantId;

async function issue(tx: Tx, ctx: SlipCtx, input: { lines: SlipLine[]; area?: string | null; billRoundId?: string; cancels?: { id: string; reference: string } }) {
  // σειρά 8.6 ανά συσκευή, όπως τα πιστωτικά λιανικής («Π» + σειρά συσκευής)
  const series = await ensureSeries(tx, ctx.org.id, "8.6", `ΔΠ${ctx.device.series}`, ctx.store.id);
  const reference = randomUUID();
  const slip = buildOrderSlip({ merchantVat: ctx.issuer.vatNumber, series: series.code, aa: series.nextAa, reference, moment: new Date(), area: input.area, lines: slipLines(input.lines), cancels: input.cancels?.reference });
  await advanceSeries(tx, series.id);
  return tx.fiscalDocument.create({
    data: {
      orgId: ctx.org.id, docType: "8.6", seriesId: series.id, aa: series.nextAa, totalCents: slip.totalCents, receiptReference: reference,
      billRoundId: input.billRoundId, relatedId: input.cancels?.id, status: live(ctx) ? "PENDING" : "NOT_SENT", request: toStoredJson(slip.data) as Prisma.InputJsonValue,
    },
    select: { id: true, status: true },
  });
}

// Η ΑΑΔΕ θέλει αριθμό τραπεζιού (TableAA) σε κάθε 8.6, και στο ακυρωτικό· λογαριασμός χωρίς τραπέζι δίνει το όνομά του.
const billArea = { select: { label: true, table: { select: { name: true } } } } as const;
const area = (b: { label: string | null; table: { name: string } | null }) => b.table?.name || b.label || "—";

/** 8.6 της αποστολής. Μέσα στη συναλλαγή του addRound. */
export async function issueRoundSlip(tx: Tx, ctx: SlipCtx, roundId: string) {
  const round = await tx.billRound.findUniqueOrThrow({ where: { id: roundId }, select: { lines: { orderBy: { id: "asc" } }, bill: billArea } });
  return issue(tx, ctx, { lines: round.lines, area: area(round.bill), billRoundId: roundId });
}

/** Ακυρωτικά 8.6 για γραμμές που ακυρώθηκαν πριν πληρωθούν: ένα ανά αρχικό 8.6. Γραμμές χωρίς 8.6 (πριν τη διαβίβαση εστίασης) αγνοούνται. */
export async function issueVoidSlips(tx: Tx, ctx: SlipCtx, lines: (SlipLine & { roundId: string })[]) {
  const byRound = Map.groupBy(lines.filter((l) => l.quantity > 0), (l) => l.roundId);
  const out: { id: string; status: string }[] = [];
  for (const [roundId, group] of byRound) {
    const original = await tx.fiscalDocument.findUnique({ where: { billRoundId: roundId }, select: { id: true, receiptReference: true, billRound: { select: { bill: billArea } } } });
    if (original) out.push(await issue(tx, ctx, { lines: group, area: original.billRound ? area(original.billRound.bill) : null, cancels: { id: original.id, reference: original.receiptReference } }));
  }
  return out;
}

/** Υπογραφή στη Viva (receipts:sign με sessionId = reference). Μετά τη συναλλαγή· ποτέ δεν πετά: η αποτυχία μένει στο 8.6. */
export async function signOrderSlips(orgId: string, merchantId: string | null, ids: string[]) {
  if (!merchantId) return;
  const { signReceipt } = await import("./viva/sign");
  for (const id of ids) {
    const claimed = await db.fiscalDocument.updateMany({ where: { id, orgId, docType: "8.6", status: { in: ["PENDING", "FAILED"] } }, data: { status: "PENDING", error: null } });
    if (!claimed.count) continue;
    const doc = await db.fiscalDocument.findUniqueOrThrow({ where: { id }, select: { request: true, receiptReference: true } });
    try {
      const signed = await signReceipt(toVivaJson({ sessionId: doc.receiptReference, ...(fromStoredJson(doc.request) as object) }), merchantId);
      await db.fiscalDocument.update({ where: { id }, data: { status: "SIGNED", mark: signed.mark, response: { uid: signed.uid ?? null, qrUrl: signed.qrUrl ?? null, raw: signed.raw as Prisma.InputJsonValue } } });
    } catch (e) {
      await db.fiscalDocument.update({ where: { id }, data: { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    }
  }
}
