BEGIN;

-- Το κεφαλαίο Ś δεν καλύπτεται από το βασικό σύνολο διακριτικών της βάσης.
CREATE TEMP TABLE "ManufacturerSAcceptNormalization" ON COMMIT DROP AS
WITH normalized AS (
  SELECT id, translate(name, 'Ś', 'S') AS normalized_name FROM "Manufacturer"
), mapped AS (
  SELECT id, normalized_name,
    first_value(id) OVER (PARTITION BY normalized_name ORDER BY id) AS keep_id
  FROM normalized
)
SELECT * FROM mapped;

UPDATE "TradeItem" AS item
SET "brandId" = keep_brand.id
FROM "ManufacturerSAcceptNormalization" AS map
JOIN "Brand" AS drop_brand ON drop_brand."manufacturerId" = map.id
JOIN "Brand" AS keep_brand ON keep_brand."manufacturerId" = map.keep_id AND keep_brand.name = drop_brand.name
WHERE item."brandId" = drop_brand.id AND map.id <> map.keep_id;

DELETE FROM "Brand" AS drop_brand
USING "ManufacturerSAcceptNormalization" AS map, "Brand" AS keep_brand
WHERE drop_brand."manufacturerId" = map.id
  AND map.id <> map.keep_id
  AND keep_brand."manufacturerId" = map.keep_id
  AND keep_brand.name = drop_brand.name;

UPDATE "Brand" AS brand
SET "manufacturerId" = map.keep_id
FROM "ManufacturerSAcceptNormalization" AS map
WHERE brand."manufacturerId" = map.id AND map.id <> map.keep_id;

DELETE FROM "Manufacturer" AS manufacturer
USING "ManufacturerSAcceptNormalization" AS map
WHERE manufacturer.id = map.id AND map.id <> map.keep_id;

UPDATE "Manufacturer" AS manufacturer
SET name = map.normalized_name
FROM "ManufacturerSAcceptNormalization" AS map
WHERE manufacturer.id = map.id AND manufacturer.id = map.keep_id;

COMMIT;
