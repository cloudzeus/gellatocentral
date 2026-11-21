-- Κοινοί συντελεστές ΦΠΑ της πλατφόρμας (σταθερά ids για να τους αναφέρει ο κώδικας)
INSERT INTO "VatRate" ("id", "name", "rate", "active") VALUES
  ('vat_24', 'Κανονικός', 24, true),
  ('vat_13', 'Μειωμένος', 13, true),
  ('vat_6', 'Υπερμειωμένος', 6, true),
  ('vat_17', 'Κανονικός νησιών', 17, true),
  ('vat_9', 'Μειωμένος νησιών', 9, true),
  ('vat_4', 'Υπερμειωμένος νησιών', 4, true),
  ('vat_0', 'Απαλλαγή', 0, true)
ON CONFLICT ("id") DO NOTHING;

-- Προϊόντα με συντελεστή εκτός λίστας: δημιουργείται καταχώριση ώστε να μη χαθεί η τιμή τους
INSERT INTO "VatRate" ("id", "name", "rate", "active")
SELECT DISTINCT 'vat_' || p."vatRate", 'ΦΠΑ ' || p."vatRate" || '%', p."vatRate", true
FROM "Product" p
WHERE NOT EXISTS (SELECT 1 FROM "VatRate" v WHERE v."rate" = p."vatRate")
ON CONFLICT ("id") DO NOTHING;

-- Σύνδεση προϊόντων με τον αντίστοιχο συντελεστή και αφαίρεση της παλιάς στήλης
ALTER TABLE "Product" ADD COLUMN "vatRateId" TEXT;
UPDATE "Product" p SET "vatRateId" = v."id" FROM "VatRate" v WHERE v."rate" = p."vatRate";
ALTER TABLE "Product" ALTER COLUMN "vatRateId" SET NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" DROP COLUMN "vatRate";

-- Οι κατηγορίες ΦΠΑ στα RefItem αντικαταστάθηκαν από το VatRate
DELETE FROM "RefItem" WHERE "list" = 'vatCategory';
