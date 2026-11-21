-- Κοινός πίνακας τύπων παραστατικών myDATA με τους προεπιλεγμένους τύπους (system: οι φορολογικοί
-- κανόνες δεν αλλάζουν από οθόνη). receiptCase = ftReceiptCase της Viva σε δεκαδικό Int64·
-- κενό = δεν εκδίδεται ακόμη (περιμένει επαληθευμένο δείγμα από το demo της Viva).
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sign" INTEGER NOT NULL,
    "retail" BOOLEAN NOT NULL,
    "needsParty" BOOLEAN NOT NULL,
    "needsRelated" BOOLEAN NOT NULL,
    "receiptCase" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");

-- 11.1: 0x4752200000000001 · 11.4: 0x4752200005000001 (δείγμα «INVOICE_RETURN_RELATED» των samples)
INSERT INTO "DocumentType" ("id", "code", "title", "sign", "retail", "needsParty", "needsRelated", "receiptCase", "active", "sort") VALUES
  ('dt_11_1', '11.1', 'Απόδειξη Λιανικής Πώλησης',                    1,  true,  false, false, '5139205309155246081', true, 1),
  ('dt_11_2', '11.2', 'Απόδειξη Παροχής Υπηρεσιών',                   1,  true,  false, false, NULL,                 true, 2),
  ('dt_11_3', '11.3', 'Απλοποιημένο Τιμολόγιο',                       1,  true,  true,  false, NULL,                 true, 3),
  ('dt_11_4', '11.4', 'Πιστωτικό Στοιχείο Λιανικής',                 -1,  true,  false, true,  '5139205309239132161', true, 4),
  ('dt_1_1',  '1.1',  'Τιμολόγιο Πώλησης',                            1,  false, true,  false, NULL,                 true, 10),
  ('dt_1_2',  '1.2',  'Τιμολόγιο Πώλησης / Ενδοκοινοτικές Παραδόσεις', 1, false, true,  false, NULL,                 true, 11),
  ('dt_2_1',  '2.1',  'Τιμολόγιο Παροχής Υπηρεσιών',                  1,  false, true,  false, NULL,                 true, 20),
  ('dt_5_1',  '5.1',  'Πιστωτικό Τιμολόγιο / Συσχετιζόμενο',         -1,  false, true,  true,  NULL,                 true, 30),
  ('dt_5_2',  '5.2',  'Πιστωτικό Τιμολόγιο / Μη Συσχετιζόμενο',      -1,  false, true,  false, NULL,                 true, 31),
  ('dt_9_3',  '9.3',  'Δελτίο Αποστολής',                             1,  false, true,  false, NULL,                 true, 40);
