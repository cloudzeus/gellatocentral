-- Ταμείο Android με τερματικό σε άλλη συσκευή (Cloud Terminal)
ALTER TABLE "Device" ADD COLUMN "vivaCloud" BOOLEAN NOT NULL DEFAULT false;
