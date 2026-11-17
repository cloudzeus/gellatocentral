-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "planId" TEXT;

-- AlterTable
ALTER TABLE "SubscriptionCharge" ADD COLUMN     "lines" JSONB,
ADD COLUMN     "planName" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "modules" TEXT[],
    "storeCents" INTEGER NOT NULL,
    "devicePrices" JSONB NOT NULL,
    "pausePercent" INTEGER NOT NULL DEFAULT 30,
    "pausedModules" TEXT[],
    "pauseMaxDaysPerYear" INTEGER NOT NULL DEFAULT 240,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePause" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "maxDays" INTEGER NOT NULL,
    "settledThrough" TIMESTAMP(3),
    "startedByName" TEXT NOT NULL,
    "endedByName" TEXT,

    CONSTRAINT "StorePause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "StorePause_storeId_startedAt_idx" ON "StorePause"("storeId", "startedAt");

-- CreateIndex
CREATE INDEX "StorePause_orgId_idx" ON "StorePause"("orgId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePause" ADD CONSTRAINT "StorePause_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Το πρώτο πακέτο, με τις τιμές που ίσχυαν ως τώρα στον κώδικα. Αλλάζει από την οθόνη «Πακέτα».
INSERT INTO "Plan" ("id", "name", "description", "isDefault", "modules", "storeCents", "devicePrices", "pausePercent", "pausedModules", "pauseMaxDaysPerYear")
VALUES ('plan_default', 'Βασικό', 'Το αρχικό πακέτο', true,
  ARRAY['dashboard','pos','receipts','customers','recipes','production','inventory','wholesale','team','finance'],
  5900, '{"POS_WEB":1500,"POS_ANDROID":1500,"KITCHEN_DISPLAY":0,"FRIDGE":0,"VENDING_MACHINE":0,"SCALE":0}'::jsonb,
  30, ARRAY['dashboard','receipts','customers'], 240);
