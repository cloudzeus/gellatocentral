BEGIN;

-- Συμπλήρωμα για διακριτικά που δεν καλύπτει το βασικό σύνολο (πολωνικά, ρουμανικά,
-- περισπωμένα ελληνικά και κυριλλικό σύντομο Ι). Οι ακριβώς ισοδύναμες εγγραφές ενώνονται πρώτα.
CREATE TEMP TABLE "ManufacturerExtendedNormalization" ON COMMIT DROP AS
WITH normalized AS (
  SELECT id,
    btrim(regexp_replace(
      translate(upper(name), 'ŃĂȘȚŁĄĒῶЙ', 'NASTLAEΩΙ'),
      '\s+', ' ', 'g'
    )) AS normalized_name
  FROM "Manufacturer"
), mapped AS (
  SELECT id, normalized_name,
    first_value(id) OVER (PARTITION BY normalized_name ORDER BY id) AS keep_id
  FROM normalized
)
SELECT * FROM mapped;

UPDATE "TradeItem" AS item
SET "brandId" = keep_brand.id
FROM "ManufacturerExtendedNormalization" AS map
JOIN "Brand" AS drop_brand ON drop_brand."manufacturerId" = map.id
JOIN "Brand" AS keep_brand ON keep_brand."manufacturerId" = map.keep_id AND keep_brand.name = drop_brand.name
WHERE item."brandId" = drop_brand.id AND map.id <> map.keep_id;

DELETE FROM "Brand" AS drop_brand
USING "ManufacturerExtendedNormalization" AS map, "Brand" AS keep_brand
WHERE drop_brand."manufacturerId" = map.id
  AND map.id <> map.keep_id
  AND keep_brand."manufacturerId" = map.keep_id
  AND keep_brand.name = drop_brand.name;

UPDATE "Brand" AS brand
SET "manufacturerId" = map.keep_id
FROM "ManufacturerExtendedNormalization" AS map
WHERE brand."manufacturerId" = map.id AND map.id <> map.keep_id;

DELETE FROM "Manufacturer" AS manufacturer
USING "ManufacturerExtendedNormalization" AS map
WHERE manufacturer.id = map.id AND map.id <> map.keep_id;

UPDATE "Manufacturer" AS manufacturer
SET name = map.normalized_name
FROM "ManufacturerExtendedNormalization" AS map
WHERE manufacturer.id = map.id AND manufacturer.id = map.keep_id;

COMMIT;
