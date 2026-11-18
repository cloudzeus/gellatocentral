-- DropIndex
DROP INDEX "PartyContact_partyId_idx";

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyChannel" (
    "id" TEXT NOT NULL,
    "partyId" TEXT,
    "personId" TEXT,
    "addressId" TEXT,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PartyChannel_pkey" PRIMARY KEY ("id")
);

-- Οι υπάρχουσες επαφές γίνονται πρόσωπα (με το ίδιο id) και τα στοιχεία επικοινωνίας τους γίνονται γραμμές PartyChannel.
ALTER TABLE "PartyContact" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "personId" TEXT;
INSERT INTO "Person" ("id", "orgId", "name") SELECT c."id", p."orgId", c."name" FROM "PartyContact" c JOIN "Party" p ON p."id" = c."partyId";
UPDATE "PartyContact" SET "personId" = "id";
INSERT INTO "PartyChannel" ("id", "personId", "kind", "value", "isPrimary") SELECT 'ph_' || "id", "id", 'phone', "phone", true FROM "PartyContact" WHERE "phone" IS NOT NULL;
INSERT INTO "PartyChannel" ("id", "personId", "kind", "value", "isPrimary") SELECT 'em_' || "id", "id", 'email', "email", true FROM "PartyContact" WHERE "email" IS NOT NULL;
-- το τηλέφωνο και το email της εταιρίας γίνονται τα κύρια κανάλια της (μένουν και στο Party)
INSERT INTO "PartyChannel" ("id", "partyId", "kind", "value", "isPrimary") SELECT 'ph_' || "id", "id", 'phone', "phone", true FROM "Party" WHERE "phone" IS NOT NULL;
INSERT INTO "PartyChannel" ("id", "partyId", "kind", "value", "isPrimary") SELECT 'em_' || "id", "id", 'email', "email", true FROM "Party" WHERE "email" IS NOT NULL;
ALTER TABLE "PartyContact" ALTER COLUMN "personId" SET NOT NULL, DROP COLUMN "email", DROP COLUMN "name", DROP COLUMN "phone";

-- CreateTable
CREATE TABLE "PartyActivity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "partyId" TEXT NOT NULL,
    "personId" TEXT,
    "kind" TEXT NOT NULL,
    "direction" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_orgId_name_idx" ON "Person"("orgId", "name");

-- CreateIndex
CREATE INDEX "PartyChannel_partyId_idx" ON "PartyChannel"("partyId");

-- CreateIndex
CREATE INDEX "PartyChannel_personId_idx" ON "PartyChannel"("personId");

-- CreateIndex
CREATE INDEX "PartyChannel_value_idx" ON "PartyChannel"("value");

-- CreateIndex
CREATE INDEX "PartyActivity_partyId_at_idx" ON "PartyActivity"("partyId", "at");

-- CreateIndex
CREATE INDEX "PartyActivity_orgId_doneAt_dueAt_idx" ON "PartyActivity"("orgId", "doneAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartyActivity_source_externalId_key" ON "PartyActivity"("source", "externalId");

-- CreateIndex
CREATE INDEX "PartyContact_personId_idx" ON "PartyContact"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyContact_partyId_personId_key" ON "PartyContact"("partyId", "personId");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyChannel" ADD CONSTRAINT "PartyChannel_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyChannel" ADD CONSTRAINT "PartyChannel_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyChannel" ADD CONSTRAINT "PartyChannel_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "PartyAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyActivity" ADD CONSTRAINT "PartyActivity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyActivity" ADD CONSTRAINT "PartyActivity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

