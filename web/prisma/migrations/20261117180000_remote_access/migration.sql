-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "remoteId" TEXT;

-- CreateTable
CREATE TABLE "RemoteAccess" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedById" TEXT,
    "startedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemoteAccess_orgId_at_idx" ON "RemoteAccess"("orgId", "at");

-- AddForeignKey
ALTER TABLE "RemoteAccess" ADD CONSTRAINT "RemoteAccess_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

