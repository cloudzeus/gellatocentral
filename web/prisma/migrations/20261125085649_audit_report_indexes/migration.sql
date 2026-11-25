-- Προσθετικό: μόνο ευρετήρια για αναφορές και εξαγωγές ανά περίοδο (docs/audit, M16). Καμία αλλαγή σε δεδομένα.
-- CreateIndex
CREATE INDEX "EmailLog_orgId_createdAt_idx" ON "EmailLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_orgId_occurredAt_idx" ON "Expense"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Sale_orgId_storeId_issuedAt_idx" ON "Sale"("orgId", "storeId", "issuedAt");

-- CreateIndex
CREATE INDEX "SaleLine_productId_idx" ON "SaleLine"("productId");

-- CreateIndex
CREATE INDEX "SalesDocument_orgId_status_issuedAt_idx" ON "SalesDocument"("orgId", "status", "issuedAt");
