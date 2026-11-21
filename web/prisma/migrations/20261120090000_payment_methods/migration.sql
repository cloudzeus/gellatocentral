-- Οι τρόποι πληρωμής γίνονται κοινό μοντέλο της πλατφόρμας (προεπιλογή: όσοι υποστηρίζει η Viva).
-- Το enum PaymentMethod (CASH/CARD) και η λίστα RefItem «paymentMethod» αποσύρονται· τα δεδομένα τους μεταφέρονται.

-- 1. Νέα στήλη στο Payment, backfill από το παλιό enum, και μετά η στήλη enum φεύγει
ALTER TABLE "Payment" ADD COLUMN "methodId" TEXT;
UPDATE "Payment" SET "methodId" = CASE "method"::text WHEN 'CASH' THEN 'pm_cash' ELSE 'pm_card' END;
ALTER TABLE "Payment" ALTER COLUMN "methodId" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "method";
DROP TYPE "PaymentMethod";

-- 2. Τα enums και ο νέος πίνακας
CREATE TYPE "PaymentProvider" AS ENUM ('VIVA_TERMINAL', 'VIVA_CHECKOUT', 'MANUAL');
CREATE TYPE "PaymentLedger" AS ENUM ('CASH', 'CARD_CLEARING', 'BANK', 'CREDIT');

CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "vivaMethodId" INTEGER,
    "vivaPosMethod" TEXT,
    "payItemCase" INTEGER,
    "myDataCode" INTEGER,
    "ledgerKind" "PaymentLedger" NOT NULL,
    "posEnabled" BOOLEAN NOT NULL DEFAULT false,
    "givesChange" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");
CREATE INDEX "PaymentMethod_active_posEnabled_sort_idx" ON "PaymentMethod"("active", "posEnabled", "sort");

-- 3. Προεπιλεγμένοι τρόποι (system: δεν διαγράφονται, αλλάζει μόνο το active).
-- payItemCase = το τελευταίο byte του ftPayItemCase (0x01 μετρητά, 0x05 κάρτα)· κενό = δεν εκδίδει απόδειξη λιανικής.
-- vivaMethodId / vivaPosMethod: οι επίσημες τιμές της Viva (Smart Checkout MethodId, terminal paymentMethod).
INSERT INTO "PaymentMethod" ("id", "code", "name", "provider", "vivaMethodId", "vivaPosMethod", "payItemCase", "myDataCode", "ledgerKind", "posEnabled", "givesChange", "system", "active", "sort") VALUES
  ('pm_cash',             'cash',              'Μετρητά',                                 'MANUAL',        NULL, NULL,          1,    3,    'CASH',          true,  true,  true, true, 0),
  ('pm_card',             'card',              'Κάρτα',                                   'VIVA_TERMINAL', 0,    'CardPresent', 5,    7,    'CARD_CLEARING', true,  false, true, true, 1),
  ('pm_iris',             'iris',              'IRIS',                                    'VIVA_TERMINAL', 29,   'IRIS',        5,    7,    'CARD_CLEARING', true,  false, true, true, 2),
  ('pm_apple_pay',        'apple_pay',         'Apple Pay',                               'VIVA_TERMINAL', 20,   'CardPresent', 5,    7,    'CARD_CLEARING', true,  false, true, true, 3),
  ('pm_google_pay',       'google_pay',        'Google Pay',                              'VIVA_TERMINAL', 21,   'CardPresent', 5,    7,    'CARD_CLEARING', true,  false, true, true, 4),
  ('pm_samsung_pay',      'samsung_pay',       'Samsung Pay',                             'VIVA_TERMINAL', 22,   'CardPresent', 5,    7,    'CARD_CLEARING', false, false, true, true, 5),
  ('pm_viva_wallet',      'viva_wallet',       'Viva Wallet',                             'VIVA_CHECKOUT', 8,    NULL,          5,    7,    'CARD_CLEARING', false, false, true, true, 6),
  ('pm_paypal',           'paypal',            'PayPal',                                  'VIVA_CHECKOUT', 23,   NULL,          5,    7,    'CARD_CLEARING', false, false, true, true, 7),
  ('pm_klarna',           'klarna',            'Klarna',                                  'VIVA_CHECKOUT', 26,   NULL,          5,    7,    'CARD_CLEARING', false, false, true, true, 8),
  ('pm_dias',             'dias',              'e-banking (ΔΙΑΣ)',                        'VIVA_CHECKOUT', 4,    NULL,          NULL, 6,    'BANK',          false, false, true, true, 9),
  ('pm_bank_transfer',    'bank_transfer',     'Τραπεζική μεταφορά',                      'MANUAL',        NULL, NULL,          NULL, 6,    'BANK',          false, false, true, true, 10),
  ('pm_business_gr',      'business_gr',       'Επαγγελματικός λογαριασμός ημεδαπής',     'MANUAL',        NULL, NULL,          NULL, 1,    'BANK',          false, false, true, true, 11),
  ('pm_business_foreign', 'business_foreign',  'Επαγγελματικός λογαριασμός αλλοδαπής',    'MANUAL',        NULL, NULL,          NULL, 2,    'BANK',          false, false, true, true, 12),
  ('pm_check',            'check',             'Επιταγή',                                 'MANUAL',        NULL, NULL,          NULL, 4,    'BANK',          false, false, true, true, 13),
  ('pm_on_credit',        'on_credit',         'Επί πιστώσει',                            'MANUAL',        NULL, NULL,          NULL, 5,    'CREDIT',        false, false, true, true, 14);

-- 4. Ο προεπιλεγμένος τρόπος πληρωμής του συναλλασσομένου δένει στο ίδιο μοντέλο (οι παλιοί κωδικοί ήταν του myDATA)
ALTER TABLE "Party" ADD COLUMN "paymentMethodId" TEXT;
UPDATE "Party" SET "paymentMethodId" = CASE "paymentMethod"
  WHEN '1' THEN 'pm_business_gr'
  WHEN '2' THEN 'pm_business_foreign'
  WHEN '3' THEN 'pm_cash'
  WHEN '4' THEN 'pm_check'
  WHEN '5' THEN 'pm_on_credit'
  WHEN '6' THEN 'pm_bank_transfer'
  WHEN '7' THEN 'pm_card'
END;
ALTER TABLE "Party" DROP COLUMN "paymentMethod";

-- 5. Η παλιά λίστα αναφοράς δεν χρειάζεται πια
DELETE FROM "RefItem" WHERE "list" = 'paymentMethod';

-- 6. Ξένα κλειδιά
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Party" ADD CONSTRAINT "Party_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
