-- Παραστατικά πριν από το ημερολόγιο: μία αρχική γραμμή με την τωρινή κατάσταση και την ώρα έκδοσης, ώστε ο έλεγχος να τα βλέπει όλα.
INSERT INTO "FiscalAttempt" ("orgId", "fiscalDocumentId", "docType", "fromStatus", "toStatus", "mark", "error", "at")
SELECT d."orgId", d."id", d."docType", NULL, d."status", d."mark", d."error", d."createdAt"
FROM "FiscalDocument" d
WHERE NOT EXISTS (SELECT 1 FROM "FiscalAttempt" a WHERE a."fiscalDocumentId" = d."id");
