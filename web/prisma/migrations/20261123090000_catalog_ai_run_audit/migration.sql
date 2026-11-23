-- Το ιστορικό κόστους AI δεν χάνεται όταν διαγράφεται ή συγχωνεύεται κατασκευαστής.
ALTER TABLE "CatalogEnrichmentRun" DROP CONSTRAINT "CatalogEnrichmentRun_manufacturerId_fkey";
ALTER TABLE "CatalogEnrichmentRun" ALTER COLUMN "manufacturerId" DROP NOT NULL;
ALTER TABLE "CatalogEnrichmentRun" ADD CONSTRAINT "CatalogEnrichmentRun_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
