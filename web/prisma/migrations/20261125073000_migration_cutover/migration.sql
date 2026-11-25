-- Ελεγχόμενο baseline/freeze/delta/cutover ανά tenant· τα παλιά runs παραμένουν συμβατά.
CREATE TYPE "MigrationRunKind" AS ENUM ('BASELINE', 'DELTA');
CREATE TYPE "MigrationCutoverStatus" AS ENUM ('PREPARING', 'FROZEN', 'DELTA_IMPORTED', 'READY', 'ACTIVE', 'ROLLED_BACK');

CREATE TABLE "MigrationCutover" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" "MigrationCutoverStatus" NOT NULL DEFAULT 'PREPARING',
  "cursor" TEXT,
  "baselineRunId" TEXT,
  "finalRunId" TEXT,
  "adapterEvidence" JSONB,
  "smoke" JSONB,
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL,
  "frozenById" TEXT,
  "frozenByName" TEXT,
  "frozenAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "activatedById" TEXT,
  "activatedByName" TEXT,
  "activatedAt" TIMESTAMP(3),
  "rolledBackById" TEXT,
  "rolledBackByName" TEXT,
  "rolledBackAt" TIMESTAMP(3),
  "rollbackReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MigrationCutover_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MigrationRun"
  ADD COLUMN "cutoverId" TEXT,
  ADD COLUMN "kind" "MigrationRunKind" NOT NULL DEFAULT 'BASELINE',
  ADD COLUMN "exportId" TEXT,
  ADD COLUMN "previousCursor" TEXT,
  ADD COLUMN "sourceCursor" TEXT,
  ADD COLUMN "exportedAt" TIMESTAMP(3),
  ADD COLUMN "bundleHash" TEXT;

CREATE UNIQUE INDEX "MigrationCutover_orgId_key" ON "MigrationCutover"("orgId");
CREATE UNIQUE INDEX "MigrationCutover_baselineRunId_key" ON "MigrationCutover"("baselineRunId");
CREATE UNIQUE INDEX "MigrationCutover_finalRunId_key" ON "MigrationCutover"("finalRunId");
CREATE INDEX "MigrationCutover_status_updatedAt_idx" ON "MigrationCutover"("status", "updatedAt");
CREATE UNIQUE INDEX "MigrationRun_orgId_exportId_key" ON "MigrationRun"("orgId", "exportId");
CREATE INDEX "MigrationRun_orgId_cutoverId_createdAt_idx" ON "MigrationRun"("orgId", "cutoverId", "createdAt");

ALTER TABLE "MigrationCutover" ADD CONSTRAINT "MigrationCutover_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MigrationCutover" ADD CONSTRAINT "MigrationCutover_baselineRunId_fkey"
  FOREIGN KEY ("baselineRunId") REFERENCES "MigrationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MigrationCutover" ADD CONSTRAINT "MigrationCutover_finalRunId_fkey"
  FOREIGN KEY ("finalRunId") REFERENCES "MigrationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_cutoverId_fkey"
  FOREIGN KEY ("cutoverId") REFERENCES "MigrationCutover"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_export_identity_check" CHECK (
  "exportId" IS NULL OR ("bundleHash" ~ '^[0-9a-f]{64}$' AND "sourceCursor" IS NOT NULL AND "exportedAt" IS NOT NULL)
);
