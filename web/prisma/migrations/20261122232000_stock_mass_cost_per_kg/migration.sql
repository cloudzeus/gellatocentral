-- Μετά το stock_cost_per_thousand, η μάζα χρειάζεται επιπλέον ×1000:
-- το ακέραιο κόστος αποθηκεύεται ανά kg ώστε ο σταθμισμένος μέσος να κρατά ακρίβεια λεπτού/kg.
UPDATE "GenericItem" gi
SET "avgCostHundredths" = (gi."avgCostHundredths"::bigint * 1000)::integer
FROM "Unit" u
WHERE u."id" = gi."baseUnitId" AND u."dimension" = 'mass';

UPDATE "StockCountLine" scl
SET "unitCostHundredths" = (scl."unitCostHundredths"::bigint * 1000)::integer
FROM "GenericItem" gi
JOIN "Unit" u ON u."id" = gi."baseUnitId"
WHERE gi."id" = scl."genericItemId" AND gi."orgId" = scl."orgId" AND u."dimension" = 'mass';

UPDATE "StockTransferLine" stl
SET "unitCostHundredths" = (stl."unitCostHundredths"::bigint * 1000)::integer
FROM "GenericItem" gi
JOIN "Unit" u ON u."id" = gi."baseUnitId"
WHERE gi."id" = stl."genericItemId" AND gi."orgId" = stl."orgId" AND u."dimension" = 'mass';
