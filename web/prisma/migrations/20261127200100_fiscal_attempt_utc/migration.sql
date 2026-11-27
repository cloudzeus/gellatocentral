-- Η βάση τρέχει σε τοπική ζώνη (Europe/Berlin) ενώ το Prisma γράφει UTC: οι προεπιλογές της βάσης γράφουν ρητά UTC.
ALTER TABLE "FiscalDocument" ALTER COLUMN "updatedAt" SET DEFAULT (now() AT TIME ZONE 'UTC');
ALTER TABLE "FiscalAttempt" ALTER COLUMN "at" SET DEFAULT (now() AT TIME ZONE 'UTC');
UPDATE "FiscalDocument" SET "updatedAt" = "createdAt" WHERE "updatedAt" > (now() AT TIME ZONE 'UTC');
ALTER TABLE "FiscalAttempt" DISABLE TRIGGER fiscal_attempt_append_only;
UPDATE "FiscalAttempt" SET "at" = ("at" AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC';
ALTER TABLE "FiscalAttempt" ENABLE TRIGGER fiscal_attempt_append_only;
