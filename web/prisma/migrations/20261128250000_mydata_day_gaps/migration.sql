-- Οι αποδείξεις που δεν ταιριάζουν (αντιστοίχιση ανά MARK με το RequestTransmittedDocs)
ALTER TABLE "MydataDayCheck" ADD COLUMN "gaps" JSONB;
UPDATE "MydataDayCheck" SET "status" = 'DIFF' WHERE "status" = 'WAITING';
