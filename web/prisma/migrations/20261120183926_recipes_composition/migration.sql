-- AlterTable
ALTER TABLE "GenericItem" ADD COLUMN     "avgCostHundredths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gramsPerPiece" INTEGER,
ADD COLUMN     "trackStock" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "tradeItemId" TEXT,
    "genericItemId" TEXT,
    "fatPm" INTEGER,
    "msnfPm" INTEGER,
    "sucrosePm" INTEGER,
    "dextrosePm" INTEGER,
    "glucoseSyrupPm" INTEGER,
    "glucoseDe" INTEGER,
    "invertSugarPm" INTEGER,
    "fructosePm" INTEGER,
    "lactosePm" INTEGER,
    "cocoaNonfatPm" INTEGER,
    "stabilizerPm" INTEGER,
    "emulsifierPm" INTEGER,
    "saltPm" INTEGER,
    "alcoholPm" INTEGER,
    "otherSolidsPm" INTEGER,
    "proteinAvailablePm" INTEGER,
    "otherProteinPm" INTEGER,
    "fiberPm" INTEGER,
    "pacOverridePm" INTEGER,
    "podOverridePm" INTEGER,
    "totalSolidsOverridePm" INTEGER,
    "acidityLevel" TEXT,
    "containsStarch" BOOLEAN NOT NULL DEFAULT false,
    "containsCocoa" BOOLEAN NOT NULL DEFAULT false,
    "allergensContains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergensTraces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isVegan" BOOLEAN NOT NULL DEFAULT false,
    "isVegetarian" BOOLEAN NOT NULL DEFAULT true,
    "isSugarFree" BOOLEAN NOT NULL DEFAULT false,
    "isGlutenFree" BOOLEAN NOT NULL DEFAULT true,
    "isLactoseFree" BOOLEAN NOT NULL DEFAULT true,
    "containsAlcohol" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Composition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'cream',
    "batchGrams" INTEGER NOT NULL DEFAULT 5000,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "grams" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Composition_tradeItemId_key" ON "Composition"("tradeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Composition_genericItemId_key" ON "Composition"("genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_orgId_name_key" ON "Recipe"("orgId", "name");

-- CreateIndex
CREATE INDEX "RecipeItem_recipeId_idx" ON "RecipeItem"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeItem_orgId_genericItemId_idx" ON "RecipeItem"("orgId", "genericItemId");

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_tradeItemId_fkey" FOREIGN KEY ("tradeItemId") REFERENCES "TradeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
