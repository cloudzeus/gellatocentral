-- Ημερολόγιο διαβιβάσεων: κάθε αλλαγή κατάστασης παραστατικού γράφεται από trigger, ώστε καμία διαδρομή κώδικα
-- (ταμείο, χονδρική, 8.6, επανάληψη) να μην την παρακάμπτει. Μόνο προσθήκη: οι γραμμές δεν αλλάζουν.
ALTER TABLE "FiscalDocument" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "FiscalAttempt" (
  "id" BIGSERIAL PRIMARY KEY,
  "orgId" TEXT,
  "fiscalDocumentId" TEXT NOT NULL,
  "docType" TEXT NOT NULL,
  "fromStatus" "FiscalStatus",
  "toStatus" "FiscalStatus" NOT NULL,
  "mark" TEXT,
  "error" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalAttempt_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FiscalAttempt_orgId_at_idx" ON "FiscalAttempt"("orgId", "at");
CREATE INDEX "FiscalAttempt_fiscalDocumentId_idx" ON "FiscalAttempt"("fiscalDocumentId");

CREATE FUNCTION fiscal_attempt_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."status" IS DISTINCT FROM OLD."status" OR NEW."mark" IS DISTINCT FROM OLD."mark" THEN
    INSERT INTO "FiscalAttempt" ("orgId", "fiscalDocumentId", "docType", "fromStatus", "toStatus", "mark", "error")
    VALUES (NEW."orgId", NEW."id", NEW."docType", CASE WHEN TG_OP = 'UPDATE' THEN OLD."status" END, NEW."status", NEW."mark", NEW."error");
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fiscal_attempt_log AFTER INSERT OR UPDATE ON "FiscalDocument" FOR EACH ROW EXECUTE FUNCTION fiscal_attempt_log();

CREATE FUNCTION fiscal_attempt_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Το ημερολόγιο διαβιβάσεων δεν αλλάζει';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fiscal_attempt_append_only BEFORE UPDATE ON "FiscalAttempt" FOR EACH ROW EXECUTE FUNCTION fiscal_attempt_append_only();
