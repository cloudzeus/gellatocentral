-- AlterEnum
ALTER TYPE "DeviceKind" ADD VALUE 'KITCHEN_DISPLAY';

-- AlterTable
ALTER TABLE "Device" ALTER COLUMN "series" DROP NOT NULL;

