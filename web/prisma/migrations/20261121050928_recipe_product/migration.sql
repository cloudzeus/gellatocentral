-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "Recipe_orgId_productId_idx" ON "Recipe"("orgId", "productId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
