-- Ο πίνακας Customer γίνεται ο κοινός «Συναλλασσόμενος» (Party): μετονομασία, ώστε να μη χαθεί καμία εγγραφή.
ALTER TABLE "Customer" RENAME TO "Party";
ALTER TABLE "Party" RENAME CONSTRAINT "Customer_pkey" TO "Party_pkey";
ALTER TABLE "Party" RENAME CONSTRAINT "Customer_orgId_fkey" TO "Party_orgId_fkey";
ALTER INDEX "Customer_orgId_vatNumber_key" RENAME TO "Party_orgId_vatNumber_key";
ALTER INDEX "Customer_orgId_name_idx" RENAME TO "Party_orgId_name_idx";

ALTER TABLE "Party" ALTER COLUMN "orgId" DROP NOT NULL,
ADD COLUMN     "roles" TEXT[],
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'GR',
ADD COLUMN     "website" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "linkedOrgId" TEXT,
ADD COLUMN     "vatCheckedAt" TIMESTAMP(3);
-- όσοι υπήρχαν ήταν πελάτες
UPDATE "Party" SET "roles" = ARRAY['customer'];

CREATE UNIQUE INDEX "Party_linkedOrgId_key" ON "Party"("linkedOrgId");
ALTER TABLE "Party" ADD CONSTRAINT "Party_linkedOrgId_fkey" FOREIGN KEY ("linkedOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PartyAddress" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "branchNo" INTEGER,
    "label" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "street" TEXT NOT NULL,
    "city" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'GR',
    "notes" TEXT,

    CONSTRAINT "PartyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyContact" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "addressId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "PartyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyBankAccount" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "bank" TEXT,
    "iban" TEXT NOT NULL,
    "holder" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartyBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefItem" (
    "id" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RefItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyAddress_partyId_idx" ON "PartyAddress"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyAddress_partyId_branchNo_key" ON "PartyAddress"("partyId", "branchNo");

-- CreateIndex
CREATE INDEX "PartyContact_partyId_idx" ON "PartyContact"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyBankAccount_partyId_iban_key" ON "PartyBankAccount"("partyId", "iban");

-- CreateIndex
CREATE INDEX "RefItem_list_active_sort_idx" ON "RefItem"("list", "active", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "RefItem_list_code_key" ON "RefItem"("list", "code");

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "PartyAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyBankAccount" ADD CONSTRAINT "PartyBankAccount_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Κάθε συνδρομητής γίνεται και συναλλασσόμενος (πελάτης) της πλατφόρμας
INSERT INTO "Party" ("id", "orgId", "roles", "name", "vatNumber", "email", "linkedOrgId", "updatedAt")
SELECT 'pty_' || o."id", NULL, ARRAY['customer'], o."name", o."vatNumber", o."contactEmail", o."id", CURRENT_TIMESTAMP FROM "Organization" o;

-- Λίστες αναφοράς. Κωδικοί τρόπων πληρωμής και κατηγοριών ΦΠΑ όπως στο myDATA. Η λίστα ΔΟΥ (taxOffice) ξεκινά άδεια:
-- συμπληρώνεται από την αναζήτηση ΑΦΜ ή από την οθόνη της πλατφόρμας.
INSERT INTO "RefItem" ("id", "list", "code", "label", "value", "sort") VALUES
  ('ref_country_GR', 'country', 'GR', 'Ελλάδα', NULL, 0),
  ('ref_country_CY', 'country', 'CY', 'Κύπρος', NULL, 1),
  ('ref_country_AT', 'country', 'AT', 'Αυστρία', NULL, 2),
  ('ref_country_BE', 'country', 'BE', 'Βέλγιο', NULL, 3),
  ('ref_country_BG', 'country', 'BG', 'Βουλγαρία', NULL, 4),
  ('ref_country_HR', 'country', 'HR', 'Κροατία', NULL, 5),
  ('ref_country_CZ', 'country', 'CZ', 'Τσεχία', NULL, 6),
  ('ref_country_DK', 'country', 'DK', 'Δανία', NULL, 7),
  ('ref_country_EE', 'country', 'EE', 'Εσθονία', NULL, 8),
  ('ref_country_FI', 'country', 'FI', 'Φινλανδία', NULL, 9),
  ('ref_country_FR', 'country', 'FR', 'Γαλλία', NULL, 10),
  ('ref_country_DE', 'country', 'DE', 'Γερμανία', NULL, 11),
  ('ref_country_HU', 'country', 'HU', 'Ουγγαρία', NULL, 12),
  ('ref_country_IE', 'country', 'IE', 'Ιρλανδία', NULL, 13),
  ('ref_country_IT', 'country', 'IT', 'Ιταλία', NULL, 14),
  ('ref_country_LV', 'country', 'LV', 'Λετονία', NULL, 15),
  ('ref_country_LT', 'country', 'LT', 'Λιθουανία', NULL, 16),
  ('ref_country_LU', 'country', 'LU', 'Λουξεμβούργο', NULL, 17),
  ('ref_country_MT', 'country', 'MT', 'Μάλτα', NULL, 18),
  ('ref_country_NL', 'country', 'NL', 'Ολλανδία', NULL, 19),
  ('ref_country_PL', 'country', 'PL', 'Πολωνία', NULL, 20),
  ('ref_country_PT', 'country', 'PT', 'Πορτογαλία', NULL, 21),
  ('ref_country_RO', 'country', 'RO', 'Ρουμανία', NULL, 22),
  ('ref_country_SK', 'country', 'SK', 'Σλοβακία', NULL, 23),
  ('ref_country_SI', 'country', 'SI', 'Σλοβενία', NULL, 24),
  ('ref_country_ES', 'country', 'ES', 'Ισπανία', NULL, 25),
  ('ref_country_SE', 'country', 'SE', 'Σουηδία', NULL, 26),
  ('ref_country_GB', 'country', 'GB', 'Ηνωμένο Βασίλειο', NULL, 27),
  ('ref_country_CH', 'country', 'CH', 'Ελβετία', NULL, 28),
  ('ref_country_NO', 'country', 'NO', 'Νορβηγία', NULL, 29),
  ('ref_country_US', 'country', 'US', 'Ηνωμένες Πολιτείες', NULL, 30),
  ('ref_country_TR', 'country', 'TR', 'Τουρκία', NULL, 31),
  ('ref_country_AL', 'country', 'AL', 'Αλβανία', NULL, 32),
  ('ref_country_MK', 'country', 'MK', 'Βόρεια Μακεδονία', NULL, 33),
  ('ref_country_RS', 'country', 'RS', 'Σερβία', NULL, 34),
  ('ref_paymentMethod_1', 'paymentMethod', '1', 'Επαγγελματικός λογαριασμός πληρωμών ημεδαπής', NULL, 0),
  ('ref_paymentMethod_2', 'paymentMethod', '2', 'Επαγγελματικός λογαριασμός πληρωμών αλλοδαπής', NULL, 1),
  ('ref_paymentMethod_3', 'paymentMethod', '3', 'Μετρητά', NULL, 2),
  ('ref_paymentMethod_4', 'paymentMethod', '4', 'Επιταγή', NULL, 3),
  ('ref_paymentMethod_5', 'paymentMethod', '5', 'Επί πιστώσει', NULL, 4),
  ('ref_paymentMethod_6', 'paymentMethod', '6', 'Web banking', NULL, 5),
  ('ref_paymentMethod_7', 'paymentMethod', '7', 'POS / e-POS', NULL, 6),
  ('ref_paymentTerm_0', 'paymentTerm', '0', 'Μετρητοίς', 0, 0),
  ('ref_paymentTerm_15', 'paymentTerm', '15', '15 ημέρες', 15, 1),
  ('ref_paymentTerm_30', 'paymentTerm', '30', '30 ημέρες', 30, 2),
  ('ref_paymentTerm_60', 'paymentTerm', '60', '60 ημέρες', 60, 3),
  ('ref_paymentTerm_90', 'paymentTerm', '90', '90 ημέρες', 90, 4),
  ('ref_paymentTerm_120', 'paymentTerm', '120', '120 ημέρες', 120, 5),
  ('ref_vatCategory_1', 'vatCategory', '1', 'ΦΠΑ 24%', 2400, 0),
  ('ref_vatCategory_2', 'vatCategory', '2', 'ΦΠΑ 13%', 1300, 1),
  ('ref_vatCategory_3', 'vatCategory', '3', 'ΦΠΑ 6%', 600, 2),
  ('ref_vatCategory_4', 'vatCategory', '4', 'ΦΠΑ 17%', 1700, 3),
  ('ref_vatCategory_5', 'vatCategory', '5', 'ΦΠΑ 9%', 900, 4),
  ('ref_vatCategory_6', 'vatCategory', '6', 'ΦΠΑ 4%', 400, 5),
  ('ref_vatCategory_7', 'vatCategory', '7', 'ΦΠΑ 0%', 0, 6),
  ('ref_vatCategory_8', 'vatCategory', '8', 'Χωρίς ΦΠΑ', NULL, 7),
  ('ref_unit_pcs', 'unit', 'pcs', 'Τεμάχια', NULL, 0),
  ('ref_unit_kg', 'unit', 'kg', 'Κιλά', NULL, 1),
  ('ref_unit_g', 'unit', 'g', 'Γραμμάρια', NULL, 2),
  ('ref_unit_lt', 'unit', 'lt', 'Λίτρα', NULL, 3),
  ('ref_unit_ml', 'unit', 'ml', 'Χιλιοστόλιτρα', NULL, 4),
  ('ref_unit_box', 'unit', 'box', 'Κιβώτια', NULL, 5);
