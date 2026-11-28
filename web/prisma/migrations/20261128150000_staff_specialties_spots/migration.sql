-- Ειδικότητες υπαλλήλων, πολλά καταστήματα ανά υπάλληλο, πρόσκληση στο portal, ρόλος στη συσκευή, θέσεις αποθήκης
-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "specialty" TEXT;

-- AlterTable
ALTER TABLE "TillShift" ADD COLUMN     "role" TEXT;

-- CreateTable
CREATE TABLE "EmployeeSpecialty" (
    "employeeId" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EmployeeSpecialty_pkey" PRIMARY KEY ("employeeId","specialty")
);

-- CreateTable
CREATE TABLE "EmployeeStore" (
    "employeeId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "EmployeeStore_pkey" PRIMARY KEY ("employeeId","storeId")
);

-- CreateTable
CREATE TABLE "EmployeeInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageSpot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSpot" (
    "genericItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "spotId" TEXT NOT NULL,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemSpot_pkey" PRIMARY KEY ("genericItemId","warehouseId")
);

-- CreateIndex
CREATE INDEX "EmployeeStore_storeId_idx" ON "EmployeeStore"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeInvite_tokenHash_key" ON "EmployeeInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeInvite_employeeId_idx" ON "EmployeeInvite"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageSpot_warehouseId_name_key" ON "StorageSpot"("warehouseId", "name");

-- CreateIndex
CREATE INDEX "ItemSpot_spotId_idx" ON "ItemSpot"("spotId");

-- AddForeignKey
ALTER TABLE "EmployeeSpecialty" ADD CONSTRAINT "EmployeeSpecialty_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeStore" ADD CONSTRAINT "EmployeeStore_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeStore" ADD CONSTRAINT "EmployeeStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInvite" ADD CONSTRAINT "EmployeeInvite_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageSpot" ADD CONSTRAINT "StorageSpot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSpot" ADD CONSTRAINT "ItemSpot_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "StorageSpot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSpot" ADD CONSTRAINT "ItemSpot_genericItemId_fkey" FOREIGN KEY ("genericItemId") REFERENCES "GenericItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Το σημερινό κατάστημα κάθε υπαλλήλου γίνεται το πρώτο του στη λίστα καταστημάτων
INSERT INTO "EmployeeStore" ("employeeId", "storeId") SELECT "id", "storeId" FROM "Employee" WHERE "storeId" IS NOT NULL ON CONFLICT DO NOTHING;
