-- Το κόστος αποθηκεύεται πλέον σε εκατοστά λεπτού ανά 1.000 βασικές μονάδες,
-- ώστε να μη χάνεται η ακρίβεια όταν η βασική μονάδα είναι mg/ml.
UPDATE "GenericItem"
SET "avgCostHundredths" = ("avgCostHundredths"::bigint * 1000)::integer;

UPDATE "StockCountLine"
SET "unitCostHundredths" = ("unitCostHundredths"::bigint * 1000)::integer;

UPDATE "StockTransferLine"
SET "unitCostHundredths" = ("unitCostHundredths"::bigint * 1000)::integer;
