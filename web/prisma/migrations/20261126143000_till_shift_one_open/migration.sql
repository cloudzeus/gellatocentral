-- Το πολύ μία ανοιχτή βάρδια ανά ταμείο (και σε ταυτόχρονα αιτήματα)
CREATE UNIQUE INDEX "TillShift_one_open_per_device" ON "TillShift"("deviceId") WHERE "endedAt" IS NULL;
