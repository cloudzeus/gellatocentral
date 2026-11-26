-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('PHONE', 'WOLT', 'EFOOD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ACCEPTED', 'READY', 'OUT', 'DELIVERED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPayment" AS ENUM ('DOOR_CASH', 'DOOR_CARD', 'PLATFORM', 'TILL');

-- CreateEnum
CREATE TYPE "CallState" AS ENUM ('RINGING', 'ANSWERED', 'ENDED', 'MISSED');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('YEASTAR', 'WOLT', 'EFOOD');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "pbxExtension" TEXT;

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "externalId" TEXT,
    "partyId" TEXT,
    "addressId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "delivery" BOOLEAN NOT NULL DEFAULT true,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "payment" "OrderPayment" NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "note" TEXT,
    "readyAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "raw" JSONB,
    "billId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "options" JSONB,
    "note" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "extension" TEXT,
    "deviceId" TEXT,
    "partyId" TEXT,
    "orderId" TEXT,
    "state" "CallState" NOT NULL DEFAULT 'RINGING',
    "seenAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_billId_key" ON "Order"("billId");

-- CreateIndex
CREATE INDEX "Order_orgId_storeId_status_createdAt_idx" ON "Order"("orgId", "storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_orgId_phone_idx" ON "Order"("orgId", "phone");

-- CreateIndex
CREATE INDEX "Order_partyId_createdAt_idx" ON "Order"("partyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orgId_source_externalId_key" ON "Order"("orgId", "source", "externalId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "Call_orgId_startedAt_idx" ON "Call"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_deviceId_state_startedAt_idx" ON "Call"("deviceId", "state", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_orgId_callId_key" ON "Call"("orgId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_orgId_kind_key" ON "Integration"("orgId", "kind");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

