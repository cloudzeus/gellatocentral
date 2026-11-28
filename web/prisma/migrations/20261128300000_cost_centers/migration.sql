-- Κέντρα κόστους και κανόνες κατανομής (ενότητα 5 του οδικού χάρτη). Το myDATA δεν έχει κέντρα κόστους: είναι διοικητικά.
-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "costCenterId" TEXT;

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "storeId" TEXT,
    "accountCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdByName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocationRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "shares" JSONB NOT NULL DEFAULT '[]',
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_storeId_key" ON "CostCenter"("storeId");

-- CreateIndex
CREATE INDEX "CostCenter_orgId_parentId_idx" ON "CostCenter"("orgId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_orgId_code_key" ON "CostCenter"("orgId", "code");

-- CreateIndex
CREATE INDEX "CostAllocationRule_orgId_sourceId_validFrom_idx" ON "CostAllocationRule"("orgId", "sourceId", "validFrom");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCenter"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocationRule" ADD CONSTRAINT "CostAllocationRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocationRule" ADD CONSTRAINT "CostAllocationRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill υπαρχουσών επιχειρήσεων με τις ίδιες προεπιλογές που φτιάχνει το ensureCostCenters (lib/cost-centers-db.ts)
-- για τις νέες· όποιος αλλάζει τη μία λίστα, αλλάζει και την άλλη.
INSERT INTO "CostCenter" ("id", "orgId", "code", "name", "kind", "source")
SELECT gen_random_uuid()::text, o."id", d.code, d.name, d.kind, 'SEED'
FROM "Organization" o
CROSS JOIN (VALUES
  ('10', 'Καταστήματα', 'STORE'),
  ('20', 'Εργαστήριο παραγωγής', 'PRODUCTION'),
  ('30', 'Διοίκηση / έδρα', 'HQ'),
  ('40', 'Διανομή', 'DELIVERY'),
  ('50', 'Μάρκετινγκ', 'HQ')
) AS d(code, name, kind);

INSERT INTO "CostCenter" ("id", "orgId", "code", "name", "kind", "parentId", "storeId", "source")
SELECT gen_random_uuid()::text, s."orgId", '10.' || row_number() OVER (PARTITION BY s."orgId" ORDER BY s."id"), s."name", 'STORE', p."id", s."id", 'SEED'
FROM "Store" s JOIN "CostCenter" p ON p."orgId" = s."orgId" AND p."code" = '10';

-- Κοινά κέντρα: εργαστήριο και έδρα με τζίρο, διανομή με παραγγελίες, μάρκετινγκ ισόποσα
INSERT INTO "CostAllocationRule" ("id", "orgId", "sourceId", "basis", "validFrom")
SELECT gen_random_uuid()::text, c."orgId", c."id",
  CASE c."code" WHEN '40' THEN 'ORDERS' WHEN '50' THEN 'EQUAL' ELSE 'REVENUE' END, DATE '2026-01-01'
FROM "CostCenter" c WHERE c."code" IN ('20', '30', '40', '50');

-- Υπάρχουσες δαπάνες: το κέντρο του καταστήματός τους, αλλιώς η έδρα
UPDATE "Expense" e SET "costCenterId" = COALESCE(
  (SELECT c."id" FROM "CostCenter" c WHERE c."storeId" = e."storeId"),
  (SELECT c."id" FROM "CostCenter" c WHERE c."orgId" = e."orgId" AND c."code" = '30'));
