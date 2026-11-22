-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "impersonatorId" TEXT;

-- CreateIndex
CREATE INDEX "Session_impersonatorId_idx" ON "Session"("impersonatorId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
