-- DropIndex
DROP INDEX "Brand_name_trgm";

-- DropIndex
DROP INDEX "EmailLog_subject_trgm";

-- DropIndex
DROP INDEX "EmailLog_to_trgm";

-- DropIndex
DROP INDEX "KbArticle_title_trgm";

-- DropIndex
DROP INDEX "Manufacturer_name_trgm";

-- DropIndex
DROP INDEX "Organization_name_trgm";

-- DropIndex
DROP INDEX "Party_city_trgm";

-- DropIndex
DROP INDEX "Party_contactName_trgm";

-- DropIndex
DROP INDEX "Party_name_trgm";

-- DropIndex
DROP INDEX "Party_phone_trgm";

-- DropIndex
DROP INDEX "Party_tradeName_trgm";

-- DropIndex
DROP INDEX "Party_vatNumber_trgm";

-- DropIndex
DROP INDEX "ProductionBatch_batchNumber_trgm";

-- DropIndex
DROP INDEX "StockLot_batchNumber_trgm";

-- DropIndex
DROP INDEX "Ticket_subject_trgm";

-- DropIndex
DROP INDEX "TradeItem_ean_trgm";

-- DropIndex
DROP INDEX "TradeItem_name_trgm";

-- DropIndex
DROP INDEX "User_email_trgm";

-- DropIndex
DROP INDEX "User_name_trgm";

-- AlterTable
ALTER TABLE "Composition" ADD COLUMN     "ingredientsText" TEXT;
