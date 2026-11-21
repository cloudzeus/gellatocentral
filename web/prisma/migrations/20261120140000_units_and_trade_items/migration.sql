-- DropIndex (IF EXISTS: η βάση ανάπτυξης είχε ήδη χάσει τον δείκτη)
DROP INDEX IF EXISTS "VatRate_rate_key";

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEL" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "toBase" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "brandId" TEXT,
    "ean" TEXT,
    "name" TEXT NOT NULL,
    "packaging" TEXT,
    "contentQty" INTEGER NOT NULL,
    "contentUnitId" TEXT NOT NULL,
    "familyCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE INDEX "Unit_dimension_active_idx" ON "Unit"("dimension", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_manufacturerId_name_key" ON "Brand"("manufacturerId", "name");

-- CreateIndex
CREATE INDEX "TradeItem_orgId_name_idx" ON "TradeItem"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_orgId_ean_key" ON "TradeItem"("orgId", "ean");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_contentUnitId_fkey" FOREIGN KEY ("contentUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Στον κεντρικό κατάλογο (orgId IS NULL) το EAN είναι μοναδικό — το @@unique([orgId, ean])
-- δεν το εγγυάται γιατί το Postgres θεωρεί τα NULL διάφορα μεταξύ τους
CREATE UNIQUE INDEX "TradeItem_central_ean_key" ON "TradeItem"("ean") WHERE "orgId" IS NULL AND "ean" IS NOT NULL;

-- Μονάδες μέτρησης της πλατφόρμας (σταθερά ids)· toBase = πόσες βασικές μονάδες (mg / ml / τεμάχιο) είναι η μία
INSERT INTO "Unit" ("id", "code", "nameEL", "dimension", "toBase", "active") VALUES
  ('unit_mg',  'mg',   'χιλιοστόγραμμο', 'mass',   1,       true),
  ('unit_g',   'g',    'γραμμάριο',      'mass',   1000,    true),
  ('unit_kg',  'kg',   'κιλό',           'mass',   1000000, true),
  ('unit_ml',  'ml',   'χιλιοστόλιτρο',  'volume', 1,       true),
  ('unit_l',   'l',    'λίτρο',          'volume', 1000,    true),
  ('unit_pcs', 'pcs',  'τεμάχιο',        'count',  1,       true)
ON CONFLICT ("id") DO NOTHING;

-- Η λίστα μονάδων στα RefItem αντικαταστάθηκε από το Unit
DELETE FROM "RefItem" WHERE "list" = 'unit';
