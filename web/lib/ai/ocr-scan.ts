// Η ορχήστρωση της σάρωσης τιμολογίου: μοντέλο όρασης → πρόχειρο PurchaseDoc + UsageEvent χρέωσης.
// Οι καθαρές συναρτήσεις (parse/χρέωση) είναι στο ocr.ts. Η υπηρεσία είναι pay-per-use:
// ανενεργή UsagePrice «ocr» = η σάρωση αρνείται πριν καεί κανένα token.

import { setting } from "../config";
import { db } from "../db";
import { matchLine } from "../purchases";
import { partySnapshot } from "../purchase-document";
import { AiError, vision } from "./openrouter";
import { createExpense } from "../finance-db";
import type { StockContext } from "../stock-scope";
import { chargeCents, expenseTotals, OCR_PROMPT, OCR_SYSTEM, parseInvoiceJson } from "./ocr";

/**
 * Σκανάρει φωτογραφία τιμολογίου και φτιάχνει πρόχειρο PurchaseDoc με γραμμές αντιστοιχισμένες
 * (ίδιος κανόνας με τη χειροκίνητη καταχώριση). Γράφει και το UsageEvent χρέωσης.
 * Επιστρέφει το id του νέου τιμολογίου. Όλα σε μία συναλλαγή: ή όλα ή τίποτα.
 */
export async function scanPurchaseInvoice(orgId: string, userName: string, supplierId: string, warehouseId: string, mime: string, base64: string): Promise<string> {
  const price = await db.usagePrice.findUnique({ where: { service: "ocr" } });
  if (!price?.active) throw new AiError("Η υπηρεσία σάρωσης τιμολογίων δεν είναι ενεργή — ενεργοποιείται από την πλατφόρμα");

  const r = await vision(OCR_SYSTEM, OCR_PROMPT, `data:${mime};base64,${base64}`);
  const inv = parseInvoiceJson(r.text);

  const usdEur = Number(await setting("USD_EUR_RATE")) || 0.92;
  const charge = chargeCents(r.costUsd, usdEur, price.markupPercent);

  if (inv.currency !== "EUR") throw new AiError(`Το τιμολόγιο είναι σε ${inv.currency} — σκάναρέ το ως έξοδο`);

  return db.$transaction(async (tx) => {
    const supplier = await tx.party.findFirst({ where: { id: supplierId, orgId, roles: { has: "supplier" } } });
    if (!supplier) throw new AiError("Άγνωστος προμηθευτής");
    if (inv.vatNumber && supplier.vatNumber && inv.vatNumber !== supplier.vatNumber)
      throw new AiError(`Το τιμολόγιο είναι του ΑΦΜ ${inv.vatNumber}, όχι του προμηθευτή που διάλεξες (${supplier.vatNumber})`);
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, orgId, active: true } });
    if (!warehouse) throw new AiError("Άγνωστη αποθήκη");
    const [org, buyer] = await Promise.all([tx.organization.findUnique({ where: { id: orgId } }), tx.party.findFirst({ where: { linkedOrgId: orgId } })]);
    if (!org) throw new AiError("Η επιχείρηση δεν βρέθηκε");

    const doc = await tx.purchaseDoc.create({
      data: {
        orgId, supplierId: supplier.id, warehouseId: warehouse.id, number: inv.number, issuedAt: inv.issuedAt,
        source: "ocr", note: "Από σάρωση OCR — απαιτείται έλεγχος πριν από την αποδοχή", mydataMark: inv.mydataMark,
        supplierSnapshot: partySnapshot(supplier), buyerSnapshot: partySnapshot({ ...buyer, name: org.name, vatNumber: org.vatNumber }),
        paymentMethod: inv.paymentMethod, paymentTerms: inv.paymentTerms, shippingMethod: inv.shippingMethod, shippingAddress: inv.shippingAddress,
        shippingCostCents: inv.shippingCostCents, otherExpensesCents: inv.otherExpensesCents, expensesVatRate: inv.expensesVatRate, createdByName: userName,
      },
    });

    const [supplierItems, tradeItems, mappings] = await Promise.all([
      tx.supplierItem.findMany({ where: { orgId, active: true } }),
      tx.tradeItem.findMany({ where: { OR: [{ orgId: null }, { orgId }] }, select: { id: true, ean: true, name: true } }),
      tx.itemMapping.findMany({ where: { orgId } }),
    ]);
    const ctx = { supplierId: supplier.id, supplierItems, tradeItems, mappings };

    for (const l of inv.lines) {
      const m = matchLine({ supplierCode: l.supplierCode, ean: l.ean, description: l.description }, ctx);
      await tx.purchaseLine.create({
        data: {
          orgId,
          documentId: doc.id,
          supplierCode: l.supplierCode,
          ean: l.ean,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountBps: l.discountBps,
          vatRate: l.vatRate,
          batchNumber: l.batchNumber,
          expiresAt: l.expiresAt,
          supplierItemId: m.supplierItemId ?? null,
          tradeItemId: m.tradeItemId ?? null,
          genericItemId: m.genericItemId ?? null,
          matchNote: m.matchNote ?? (m.suggestion ? `suggest:${m.suggestion.tradeItemId}` : null),
        },
      });
    }

    await tx.usageEvent.create({
      data: {
        orgId,
        service: "ocr",
        units: 1,
        costUsd: r.costUsd,
        chargeCents: charge,
        detail: { model: r.model, purchaseDocId: doc.id, lines: inv.lines.length, promptTokens: r.promptTokens, completionTokens: r.completionTokens },
        createdByName: userName,
      },
    });
    return doc.id;
  });
}

/**
 * Σκανάρει τιμολόγιο υπηρεσίας (λογισμικό, ενέργεια, συνδρομές) ως ένα Expense, χωρίς αποθήκη και γραμμές.
 * Χωρίς επιλεγμένο προμηθευτή, δοκιμάζει τον ΑΦΜ του τιμολογίου. USD → EUR με την ισοτιμία πλατφόρμας, γραμμένη στη σημείωση.
 */
export async function scanExpense(ctx: StockContext, storeId: string | null, supplierId: string | null, mime: string, base64: string): Promise<string> {
  const price = await db.usagePrice.findUnique({ where: { service: "ocr" } });
  if (!price?.active) throw new AiError("Η υπηρεσία σάρωσης τιμολογίων δεν είναι ενεργή — ενεργοποιείται από την πλατφόρμα");

  const r = await vision(OCR_SYSTEM, OCR_PROMPT, `data:${mime};base64,${base64}`);
  const inv = parseInvoiceJson(r.text);
  const usdEur = Number(await setting("USD_EUR_RATE")) || 0.92;
  const t = expenseTotals(inv, usdEur);
  supplierId ||= inv.vatNumber ? (await db.party.findFirst({ where: { orgId: ctx.orgId, vatNumber: inv.vatNumber, roles: { has: "supplier" } }, select: { id: true } }))?.id ?? null : null;

  const fx = t.rate === 1 ? "" : ` · ${(t.originalCents / 100).toFixed(2)} ${inv.currency} × ${t.rate}`;
  const expense = await createExpense(ctx, {
    storeId, supplierId, category: inv.category ?? "Λοιπά έξοδα", documentNumber: inv.number, netCents: t.netCents, vatRate: t.vatRate,
    occurredAt: inv.issuedAt ?? new Date(), note: `Από σάρωση OCR${fx} — έλεγξε τα ποσά`,
  });
  // shortcut: η χρέωση γράφεται μετά το έξοδο, όχι στην ίδια συναλλαγή (το createExpense ανοίγει δική του)
  await db.usageEvent.create({
    data: {
      orgId: ctx.orgId, service: "ocr", units: 1, costUsd: r.costUsd, chargeCents: chargeCents(r.costUsd, usdEur, price.markupPercent),
      detail: { model: r.model, expenseId: expense.id, promptTokens: r.promptTokens, completionTokens: r.completionTokens }, createdByName: ctx.userName,
    },
  });
  return expense.id;
}
