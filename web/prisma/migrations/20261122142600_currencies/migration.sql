-- Κοινά νομίσματα ISO 4217 για όλη την πλατφόρμα, με το σύμβολο εμφάνισης.
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");
CREATE INDEX "Currency_active_sort_code_idx" ON "Currency"("active", "sort", "code");

INSERT INTO "Currency" ("id", "code", "name", "symbol", "active", "sort") VALUES
  ('cur_eur', 'EUR', 'Ευρώ', '€', true, 0),
  ('cur_usd', 'USD', 'Δολάριο ΗΠΑ', '$', true, 10),
  ('cur_gbp', 'GBP', 'Βρετανική λίρα', '£', true, 20),
  ('cur_chf', 'CHF', 'Ελβετικό φράγκο', 'CHF', true, 30),
  ('cur_jpy', 'JPY', 'Ιαπωνικό γιεν', '¥', true, 40),
  ('cur_cny', 'CNY', 'Κινεζικό γουάν', 'CN¥', true, 50),
  ('cur_aud', 'AUD', 'Αυστραλιανό δολάριο', 'A$', true, 60),
  ('cur_cad', 'CAD', 'Καναδικό δολάριο', 'C$', true, 70),
  ('cur_nzd', 'NZD', 'Νεοζηλανδικό δολάριο', 'NZ$', true, 80),
  ('cur_sek', 'SEK', 'Σουηδική κορώνα', 'kr', true, 90),
  ('cur_nok', 'NOK', 'Νορβηγική κορώνα', 'kr', true, 100),
  ('cur_dkk', 'DKK', 'Δανική κορώνα', 'kr', true, 110),
  ('cur_pln', 'PLN', 'Πολωνικό ζλότι', 'zł', true, 120),
  ('cur_czk', 'CZK', 'Τσεχική κορώνα', 'Kč', true, 130),
  ('cur_huf', 'HUF', 'Ουγγρικό φιορίνι', 'Ft', true, 140),
  ('cur_ron', 'RON', 'Ρουμανικό λέου', 'lei', true, 150),
  ('cur_bgn', 'BGN', 'Βουλγαρικό λεβ', 'лв', true, 160),
  ('cur_try', 'TRY', 'Τουρκική λίρα', '₺', true, 170),
  ('cur_rub', 'RUB', 'Ρωσικό ρούβλι', '₽', true, 180),
  ('cur_uah', 'UAH', 'Ουκρανική γρίβνα', '₴', true, 190),
  ('cur_inr', 'INR', 'Ινδική ρουπία', '₹', true, 200),
  ('cur_krw', 'KRW', 'Νοτιοκορεατικό γουόν', '₩', true, 210),
  ('cur_brl', 'BRL', 'Βραζιλιάνικο ρεάλ', 'R$', true, 220),
  ('cur_mxn', 'MXN', 'Μεξικανικό πέσο', 'MX$', true, 230),
  ('cur_zar', 'ZAR', 'Ραντ Νότιας Αφρικής', 'R', true, 240),
  ('cur_aed', 'AED', 'Ντιρχάμ ΗΑΕ', 'د.إ', true, 250),
  ('cur_sar', 'SAR', 'Σαουδαραβικό ριγιάλ', '﷼', true, 260),
  ('cur_ils', 'ILS', 'Ισραηλινό σέκελ', '₪', true, 270),
  ('cur_hkd', 'HKD', 'Δολάριο Χονγκ Κονγκ', 'HK$', true, 280),
  ('cur_sgd', 'SGD', 'Δολάριο Σιγκαπούρης', 'S$', true, 290),
  ('cur_thb', 'THB', 'Ταϊλανδικό μπατ', '฿', true, 300);
