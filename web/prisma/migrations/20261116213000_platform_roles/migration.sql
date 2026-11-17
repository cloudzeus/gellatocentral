-- Ρόλοι προσωπικού πλατφόρμας στη θέση της σημαίας isPlatformAdmin· οι ρόλοι συστήματος των συνδρομητών μετονομάζονται.
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'STAFF', 'SUPPORT');
ALTER TABLE "User" ADD COLUMN "platformRole" "PlatformRole";
UPDATE "User" SET "platformRole" = 'SUPER_ADMIN' WHERE "isPlatformAdmin";
ALTER TABLE "User" DROP COLUMN "isPlatformAdmin";

UPDATE "OrgRole" SET "name" = 'Επιχειρηματίας' WHERE "system" AND "name" = 'Ιδιοκτήτης';
UPDATE "OrgRole" SET "name" = 'Manager' WHERE "system" AND "name" = 'Υπεύθυνος';
UPDATE "OrgRole" SET "name" = 'Υπάλληλος' WHERE "system" AND "name" = 'Ταμίας';
