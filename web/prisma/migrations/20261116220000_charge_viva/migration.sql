-- AlterTable
ALTER TABLE "SubscriptionCharge" ADD COLUMN     "vivaOrderCode" TEXT,
ADD COLUMN     "vivaTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_vivaOrderCode_key" ON "SubscriptionCharge"("vivaOrderCode");

