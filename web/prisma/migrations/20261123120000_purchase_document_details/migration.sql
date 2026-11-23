-- Ιστορικά στοιχεία, εμπορικοί όροι και αναλυτική φορολογία παραστατικών αγοράς.
ALTER TABLE "PurchaseDoc"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "supplierSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "buyerSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherExpensesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expensesVatRate" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "PurchaseLine"
  ADD COLUMN IF NOT EXISTS "discountBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vatRate" INTEGER NOT NULL DEFAULT 0;

-- Τα παλιά παραστατικά κρατούν τα στοιχεία που ίσχυαν κατά τη μετάβαση, όχι ζωντανές αναφορές.
UPDATE "PurchaseDoc" d
SET "supplierSnapshot" = jsonb_build_object(
  'name', p."name", 'tradeName', p."tradeName", 'vatNumber', p."vatNumber",
  'taxOffice', p."taxOffice", 'profession', p."profession", 'address', p."address",
  'city', p."city", 'postalCode', p."postalCode", 'countryCode', p."countryCode",
  'phone', p."phone", 'email', p."email"
)
FROM "Party" p
WHERE p."id" = d."supplierId" AND d."supplierSnapshot" IS NULL;

UPDATE "PurchaseDoc" d
SET "buyerSnapshot" = jsonb_build_object(
  'name', o."name", 'tradeName', bp."tradeName", 'vatNumber', o."vatNumber",
  'taxOffice', bp."taxOffice", 'profession', bp."profession", 'address', bp."address",
  'city', bp."city", 'postalCode', bp."postalCode", 'countryCode', COALESCE(bp."countryCode", 'GR'),
  'phone', bp."phone", 'email', COALESCE(bp."email", o."contactEmail")
)
FROM "Organization" o
LEFT JOIN "Party" bp ON bp."linkedOrgId" = o."id"
WHERE o."id" = d."orgId" AND d."buyerSnapshot" IS NULL;

-- Όπου υπάρχει αντιστοίχιση με γενικό είδος, ο συντελεστής προέρχεται από το ιστορικό αρχείο είδους.
UPDATE "PurchaseLine" l
SET "vatRate" = vr."rate"
FROM "GenericItem" gi
JOIN "VatRate" vr ON vr."id" = gi."vatRateId"
WHERE gi."id" = l."genericItemId" AND gi."orgId" = l."orgId" AND l."vatRate" = 0;
