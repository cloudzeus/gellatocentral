-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "androidId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "tillPinHash" TEXT;

-- CreateTable
CREATE TABLE "TillShift" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "openingCents" INTEGER NOT NULL,
    "expectedCents" INTEGER,
    "countedCents" INTEGER,
    "keptCents" INTEGER,
    "reason" TEXT,
    "summary" JSONB,

    CONSTRAINT "TillShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TillDayClose" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "TillDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TillShift_deviceId_endedAt_idx" ON "TillShift"("deviceId", "endedAt");

-- CreateIndex
CREATE INDEX "TillShift_orgId_startedAt_idx" ON "TillShift"("orgId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TillDayClose_deviceId_day_key" ON "TillDayClose"("deviceId", "day");

-- AddForeignKey
ALTER TABLE "TillShift" ADD CONSTRAINT "TillShift_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillShift" ADD CONSTRAINT "TillShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillDayClose" ADD CONSTRAINT "TillDayClose_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
