-- Nullable κλειδιά: οι υπάρχουσες πληρωμές παραμένουν χωρίς backfill και η Postgres επιτρέπει πολλαπλά NULL.
ALTER TABLE "CustomerPayment"
ADD COLUMN "clientKey" TEXT,
ADD COLUMN "requestHash" TEXT;

ALTER TABLE "SupplierPayment"
ADD COLUMN "clientKey" TEXT,
ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "CustomerPayment_orgId_clientKey_key" ON "CustomerPayment"("orgId", "clientKey");
CREATE UNIQUE INDEX "SupplierPayment_orgId_clientKey_key" ON "SupplierPayment"("orgId", "clientKey");
