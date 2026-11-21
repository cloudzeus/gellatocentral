-- Τριγραμμικά (GIN) indexes για τις αναζητήσεις «περιέχει» (ILIKE '%…%').
-- Τα btree indexes δεν βοηθούν εκεί — χωρίς αυτά κάθε αναζήτηση σαρώνει ολόκληρο τον πίνακα.
-- Κρίσιμο για τον κεντρικό κατάλογο (TradeItem), που μεγαλώνει συνέχεια από την εισαγωγή Open Food Facts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Κεντρικός κατάλογος ειδών: αναζήτηση με όνομα ή EAN (σελίδα καταλόγου, σάρωση στο POS, mapping)
CREATE INDEX IF NOT EXISTS "TradeItem_name_trgm" ON "TradeItem" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "TradeItem_ean_trgm" ON "TradeItem" USING gin ("ean" gin_trgm_ops);

-- Κατασκευαστές και brands: αναζήτηση στην κάρτα του καταλόγου
CREATE INDEX IF NOT EXISTS "Manufacturer_name_trgm" ON "Manufacturer" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Brand_name_trgm" ON "Brand" USING gin ("name" gin_trgm_ops);

-- Συναλλασσόμενοι (CRM): αναζήτηση με όνομα, επωνυμία, ΑΦΜ, τηλέφωνο, πόλη
CREATE INDEX IF NOT EXISTS "Party_name_trgm" ON "Party" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Party_tradeName_trgm" ON "Party" USING gin ("tradeName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Party_vatNumber_trgm" ON "Party" USING gin ("vatNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Party_phone_trgm" ON "Party" USING gin ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Party_contactName_trgm" ON "Party" USING gin ("contactName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Party_city_trgm" ON "Party" USING gin ("city" gin_trgm_ops);

-- Οργανισμοί και χρήστες: αναζήτηση στην κονσόλα πλατφόρμας και στη διαχείριση χρηστών
CREATE INDEX IF NOT EXISTS "Organization_name_trgm" ON "Organization" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_name_trgm" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_email_trgm" ON "User" USING gin ("email" gin_trgm_ops);

-- Αιτήματα υποστήριξης και βάση γνώσεων: αναζήτηση σε θέμα/τίτλο
CREATE INDEX IF NOT EXISTS "Ticket_subject_trgm" ON "Ticket" USING gin ("subject" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "KbArticle_title_trgm" ON "KbArticle" USING gin ("title" gin_trgm_ops);

-- Ιχνηλασιμότητα: αναζήτηση με αριθμό παρτίδας
CREATE INDEX IF NOT EXISTS "StockLot_batchNumber_trgm" ON "StockLot" USING gin ("batchNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductionBatch_batchNumber_trgm" ON "ProductionBatch" USING gin ("batchNumber" gin_trgm_ops);

-- Email log: αναζήτηση με παραλήπτη ή θέμα
CREATE INDEX IF NOT EXISTS "EmailLog_to_trgm" ON "EmailLog" USING gin ("to" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EmailLog_subject_trgm" ON "EmailLog" USING gin ("subject" gin_trgm_ops);
