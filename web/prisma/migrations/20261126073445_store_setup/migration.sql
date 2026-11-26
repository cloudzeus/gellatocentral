-- CreateEnum
CREATE TYPE "StoreKind" AS ENUM ('SHOP_TABLES', 'WORKSHOP', 'VENDING', 'VENDING_STOCK');

-- CreateEnum
CREATE TYPE "PrinterRole" AS ENUM ('RECEIPTS', 'ORDERS');

-- AlterTable
ALTER TABLE "Printer" ADD COLUMN     "role" "PrinterRole" NOT NULL DEFAULT 'RECEIPTS';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "kind" "StoreKind";
