-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aadeSubKey" TEXT,
ADD COLUMN     "aadeUserId" TEXT;

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chargeCents" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsagePrice" (
    "service" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "markupPercent" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UsagePrice_pkey" PRIMARY KEY ("service")
);

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_service_createdAt_idx" ON "UsageEvent"("orgId", "service", "createdAt");

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Αρχική τιμολογιακή πολιτική pay-as-you-go: OCR τιμολογίων ενεργό με markup 30%
INSERT INTO "UsagePrice" ("service", "label", "unitLabel", "markupPercent", "active")
VALUES ('ocr', 'Ανάγνωση τιμολογίου (OCR)', 'ανά έγγραφο', 30, true);
