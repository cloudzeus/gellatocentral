// Αποδοχή τιμολογίου αγοράς (docs/analysis/PROCUREMENT-DESIGN.md §9 βήμα 5):
// για κάθε αντιστοιχισμένη γραμμή γράφει παρτίδα (StockLot), κίνηση εισόδου σε βασική μονάδα
// και — αν άλλαξε η τιμή — νέα SupplierItemPrice. Όλα σε ΜΙΑ συναλλαγή: ή όλα ή τίποτα.

import { PurchaseError, lineBaseQty, perPackCents, purchaseUnitCostHundredths } from "./purchases";
import { priceCheck, shouldWritePrice } from "./purchase-pricing";
import { genericStockBalance, postStockMovement, STOCK_ERROR_MESSAGE, StockError } from "./stock-db";
import { stockTransaction } from "./stock-transaction";
import { assertStockScope, STOCK_SCOPE_ERROR_MESSAGE, StockScopeError, type StockContext } from "./stock-scope";

export async function postPurchase(ctx: StockContext, docId: string) {
  const orgId = ctx.orgId;
  try {
    return await stockTransaction(async (tx) => {
      const doc = await tx.purchaseDoc.findFirst({
        where: { id: docId, orgId },
        include: {
          lines: {
            include: {
              supplierItem: { include: { prices: { orderBy: { validFrom: "desc" } } } },
              tradeItem: { include: { contentUnit: true } },
              genericItem: { include: { baseUnit: true } },
            },
          },
        },
      });
      if (!doc) throw new PurchaseError("Το τιμολόγιο δεν βρέθηκε");
      if (doc.status !== "DRAFT") throw new PurchaseError("Το τιμολόγιο έχει ήδη καταχωρηθεί");
      if (!doc.lines.length) throw new PurchaseError("Το τιμολόγιο δεν έχει γραμμές");
      const unmatched = doc.lines.find((l) => !l.genericItemId || !l.tradeItemId);
      if (unmatched) throw new PurchaseError(`Η γραμμή «${unmatched.description}» δεν έχει αντιστοιχιστεί`);
      await assertStockScope(tx, ctx, { warehouseId: doc.warehouseId, forWrite: true });

      const at = doc.issuedAt ?? new Date();
      for (const line of doc.lines) {
        const packQty = line.supplierItem?.packQty ?? 1;
        const content = line.tradeItem!.contentQty;
        if (line.tradeItem!.contentUnit.dimension !== line.genericItem!.baseUnit.dimension) {
          throw new PurchaseError(`Η γραμμή «${line.description}» έχει ασύμβατη μονάδα (${line.tradeItem!.contentUnit.code} προς ${line.genericItem!.baseUnit.code})`);
        }
        const qtyBase = lineBaseQty(line.quantity, packQty, content);
        const generic = line.genericItem!;
        const perPack = perPackCents(line.unitPriceCents, packQty);
        const pH = purchaseUnitCostHundredths(perPack, content, generic.baseUnit.dimension);
        // Q είναι το απόθεμα ΠΡΙΝ από την είσοδο. Serializable + πλήρες retry εμποδίζουν χαμένη ενημέρωση κόστους.
        const stock = generic.trackStock ? await genericStockBalance(tx, orgId, generic.id) : 0;

        // Είδη χωρίς απόθεμα (trackStock=false, π.χ. νερό βρύσης): κοστολογούνται, δεν ακουμπούν παρτίδες
        if (generic.trackStock) {
          // Παρτίδα: βρες ή φτιάξε (χωρίς batch → η μοναδική «χύμα» παρτίδα του είδους στην αποθήκη)
          let lot = await tx.stockLot.findFirst({
            where: { orgId, genericItemId: generic.id, warehouseId: doc.warehouseId, batchNumber: line.batchNumber ?? null },
          });
          if (!lot) {
            lot = await tx.stockLot.create({
              data: { orgId, genericItemId: generic.id, warehouseId: doc.warehouseId, batchNumber: line.batchNumber ?? null, expiresAt: line.expiresAt ?? null, documentId: doc.id },
            });
          } else if (!lot.expiresAt && line.expiresAt) {
            lot = await tx.stockLot.update({ where: { id: lot.id }, data: { expiresAt: line.expiresAt } });
          }

          await postStockMovement(tx, {
            orgId,
            warehouseId: doc.warehouseId,
            documentId: doc.id,
            lineId: line.id,
            quantity: qtyBase,
            genericItemId: generic.id,
            lotId: lot.id,
            source: "purchase",
            occurredAt: at,
            actor: { id: ctx.userId, name: ctx.userName },
          });
        }

        // Μέσο σταθμισμένο κόστος (εκατοστά λεπτού ανά kg/l ή 1.000 τεμ.): A′ = (Q·A + q·p)/(Q+q).
        if (pH > 0) {
          const next = !generic.trackStock || stock <= 0
            ? Math.round(pH)
            : Math.round((stock * generic.avgCostHundredths + qtyBase * pH) / (stock + qtyBase));
          if (next !== generic.avgCostHundredths) await tx.genericItem.update({ where: { id: generic.id }, data: { avgCostHundredths: next } });
        }

        // Η τιμή του τιμολογίου ενημερώνει τον τιμοκατάλογο του προμηθευτή αν άλλαξε —
        // αλλά ποτέ την ειδική συμφωνία: εκεί η διαφορά μένει ως διεκδίκηση (shouldWritePrice)
        if (line.supplierItem) {
          if (shouldWritePrice(priceCheck(perPack, line.supplierItem.prices, line.quantity * packQty, at))) {
            await tx.supplierItemPrice.create({
              data: {
                supplierItemId: line.supplierItem.id,
                priceCents: perPack,
                validFrom: at,
                note: `Από τιμολόγιο${doc.number ? ` ${doc.number}` : ""}`,
                createdByName: doc.createdByName,
              },
            });
          }
        }
      }

      return tx.purchaseDoc.update({ where: { id: doc.id }, data: { status: "POSTED" } });
    });
  } catch (error) {
    if (error instanceof StockError) throw new PurchaseError(STOCK_ERROR_MESSAGE[error.code]);
    if (error instanceof StockScopeError) throw new PurchaseError(STOCK_SCOPE_ERROR_MESSAGE[error.code]);
    throw error;
  }
}
