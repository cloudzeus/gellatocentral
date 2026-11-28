-- Οθόνη κουζίνας: σταθμός ανά κατηγορία και ανά οθόνη, όρια χρόνου, «έτοιμο» ανά γραμμή
CREATE TYPE "KitchenStation" AS ENUM ('KITCHEN', 'BAR');
ALTER TABLE "Category" ADD COLUMN "station" "KitchenStation";
ALTER TABLE "Device" ADD COLUMN "station" "KitchenStation", ADD COLUMN "kdsWarnMin" INTEGER NOT NULL DEFAULT 8, ADD COLUMN "kdsLateMin" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "BillLine" ADD COLUMN "readyAt" TIMESTAMP(3);
