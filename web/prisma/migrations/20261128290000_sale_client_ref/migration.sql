-- Κλειδί επανάληψης πώλησης από το ταμείο (POST /api/pos/sales). Τα NULL δεν συγκρούονται: οι παλιές πωλήσεις μένουν όπως είναι.
ALTER TABLE "Sale" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Sale_deviceId_clientRef_key" ON "Sale"("deviceId", "clientRef");
