-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "regionCode" TEXT;

-- AlterTable
ALTER TABLE "PartyAddress" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "regionCode" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "regionCode" TEXT;

-- CreateTable
CREATE TABLE "GeoCountry" (
    "code" TEXT NOT NULL,
    "iso3" TEXT,
    "nameEL" TEXT NOT NULL,
    "nameEN" TEXT NOT NULL,
    "isEu" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GeoCountry_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "GeoRegion" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "nameEL" TEXT NOT NULL,
    "nameOfficial" TEXT,
    "parentCode" TEXT,
    "path" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GeoRegion_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "GeoCity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'GR',
    "municipalityCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "population" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'geonames',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GeoCity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoArea" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "GeoArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoCountry_active_nameEL_idx" ON "GeoCountry"("active", "nameEL");

-- CreateIndex
CREATE INDEX "GeoRegion_parentCode_idx" ON "GeoRegion"("parentCode");

-- CreateIndex
CREATE INDEX "GeoRegion_level_active_nameEL_idx" ON "GeoRegion"("level", "active", "nameEL");

-- CreateIndex
CREATE INDEX "GeoRegion_path_idx" ON "GeoRegion"("path");

-- CreateIndex
CREATE INDEX "GeoCity_name_idx" ON "GeoCity"("name");

-- CreateIndex
CREATE INDEX "GeoCity_municipalityCode_population_idx" ON "GeoCity"("municipalityCode", "population");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCity_countryCode_municipalityCode_name_key" ON "GeoCity"("countryCode", "municipalityCode", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GeoArea_cityId_name_key" ON "GeoArea"("cityId", "name");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "GeoRegion"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "GeoRegion"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "GeoRegion"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "GeoArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoRegion" ADD CONSTRAINT "GeoRegion_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "GeoRegion"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCity" ADD CONSTRAINT "GeoCity_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "GeoCountry"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCity" ADD CONSTRAINT "GeoCity_municipalityCode_fkey" FOREIGN KEY ("municipalityCode") REFERENCES "GeoRegion"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoArea" ADD CONSTRAINT "GeoArea_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "GeoCity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
