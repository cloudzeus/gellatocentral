-- Λίστα αναφοράς «Περιοχές»: οι 13 περιφέρειες της Ελλάδας. Αλλάζει από την οθόνη «Λίστες αναφοράς».
INSERT INTO "RefItem" ("id", "list", "code", "label", "sort") VALUES
  ('ref_region_01', 'region', '01', 'Αττική', 0),
  ('ref_region_02', 'region', '02', 'Κεντρική Μακεδονία', 1),
  ('ref_region_03', 'region', '03', 'Ανατολική Μακεδονία και Θράκη', 2),
  ('ref_region_04', 'region', '04', 'Δυτική Μακεδονία', 3),
  ('ref_region_05', 'region', '05', 'Ήπειρος', 4),
  ('ref_region_06', 'region', '06', 'Θεσσαλία', 5),
  ('ref_region_07', 'region', '07', 'Ιόνια Νησιά', 6),
  ('ref_region_08', 'region', '08', 'Δυτική Ελλάδα', 7),
  ('ref_region_09', 'region', '09', 'Στερεά Ελλάδα', 8),
  ('ref_region_10', 'region', '10', 'Πελοπόννησος', 9),
  ('ref_region_11', 'region', '11', 'Βόρειο Αιγαίο', 10),
  ('ref_region_12', 'region', '12', 'Νότιο Αιγαίο', 11),
  ('ref_region_13', 'region', '13', 'Κρήτη', 12)
ON CONFLICT DO NOTHING;
