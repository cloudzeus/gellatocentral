-- CreateTable
CREATE TABLE "VatRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VatRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VatRate_name_key" ON "VatRate"("name");

-- CreateIndex
CREATE INDEX "VatRate_active_idx" ON "VatRate"("active");
