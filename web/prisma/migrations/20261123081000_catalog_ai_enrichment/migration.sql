-- Μόνο AI εμπλουτισμός κατασκευαστών· δεν αγγίζει τις παράλληλες αλλαγές PurchaseDoc/PurchaseLine.
ALTER TABLE "Manufacturer"
ADD COLUMN "website" TEXT,
ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "enrichmentSource" JSONB,
ADD COLUMN "enrichedAt" TIMESTAMP(3),
ADD COLUMN "enrichmentError" TEXT;

CREATE TABLE "RawIngredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "RawIngredient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManufacturerIngredient" (
    "manufacturerId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "pastryRelevant" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturerIngredient_pkey" PRIMARY KEY ("manufacturerId", "ingredientId")
);

CREATE TABLE "ManufacturerMergeSuggestion" (
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturerMergeSuggestion_pkey" PRIMARY KEY ("sourceId", "targetId")
);

CREATE TABLE "CatalogEnrichmentRun" (
    "id" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogEnrichmentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RawIngredient_normalizedName_key" ON "RawIngredient"("normalizedName");
CREATE INDEX "ManufacturerIngredient_ingredientId_pastryRelevant_idx" ON "ManufacturerIngredient"("ingredientId", "pastryRelevant");
CREATE INDEX "ManufacturerMergeSuggestion_targetId_idx" ON "ManufacturerMergeSuggestion"("targetId");
CREATE INDEX "CatalogEnrichmentRun_createdAt_idx" ON "CatalogEnrichmentRun"("createdAt");
CREATE INDEX "CatalogEnrichmentRun_manufacturerId_createdAt_idx" ON "CatalogEnrichmentRun"("manufacturerId", "createdAt");

ALTER TABLE "ManufacturerIngredient" ADD CONSTRAINT "ManufacturerIngredient_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturerIngredient" ADD CONSTRAINT "ManufacturerIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "RawIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturerMergeSuggestion" ADD CONSTRAINT "ManufacturerMergeSuggestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Manufacturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturerMergeSuggestion" ADD CONSTRAINT "ManufacturerMergeSuggestion_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Manufacturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogEnrichmentRun" ADD CONSTRAINT "CatalogEnrichmentRun_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
