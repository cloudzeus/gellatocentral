-- CreateTable
CREATE TABLE "MembershipWarehouse" (
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipWarehouse_pkey" PRIMARY KEY ("membershipId","warehouseId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "storeId" TEXT,
    "warehouseId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipWarehouse_orgId_warehouseId_idx" ON "MembershipWarehouse"("orgId", "warehouseId");

-- CreateIndex
CREATE INDEX "MembershipWarehouse_warehouseId_idx" ON "MembershipWarehouse"("warehouseId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_entityType_entityId_createdAt_idx" ON "AuditEvent"("orgId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_createdAt_idx" ON "AuditEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_warehouseId_createdAt_idx" ON "AuditEvent"("orgId", "warehouseId", "createdAt");

-- AddForeignKey
ALTER TABLE "MembershipWarehouse" ADD CONSTRAINT "MembershipWarehouse_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipWarehouse" ADD CONSTRAINT "MembershipWarehouse_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipWarehouse" ADD CONSTRAINT "MembershipWarehouse_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
