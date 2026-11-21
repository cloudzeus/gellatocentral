-- AlterTable
ALTER TABLE "TradeItem" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "TradeCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TradeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeCategory_parentId_name_key" ON "TradeCategory"("parentId", "name");

-- CreateIndex
CREATE INDEX "TradeItem_categoryId_idx" ON "TradeItem"("categoryId");

-- AddForeignKey
ALTER TABLE "TradeCategory" ADD CONSTRAINT "TradeCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TradeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TradeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
