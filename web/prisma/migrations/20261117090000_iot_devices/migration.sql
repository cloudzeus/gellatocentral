-- CreateEnum
CREATE TYPE "ReadingKind" AS ENUM ('TEMPERATURE', 'WEIGHT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceKind" ADD VALUE 'FRIDGE';
ALTER TYPE "DeviceKind" ADD VALUE 'VENDING_MACHINE';
ALTER TYPE "DeviceKind" ADD VALUE 'SCALE';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "linkedDeviceId" TEXT,
ADD COLUMN     "tempMax" DOUBLE PRECISION,
ADD COLUMN     "tempMin" DOUBLE PRECISION,
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "ReadingKind" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reading_deviceId_at_idx" ON "Reading"("deviceId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Device_warehouseId_key" ON "Device"("warehouseId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_linkedDeviceId_fkey" FOREIGN KEY ("linkedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

