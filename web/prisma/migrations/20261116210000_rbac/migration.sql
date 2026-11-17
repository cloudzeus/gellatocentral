-- RBAC: οι τρεις σταθεροί ρόλοι (enum) γίνονται ρόλοι ανά επιχείρηση με λίστα δικαιωμάτων.
CREATE TABLE "OrgRole" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrgRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgRole_orgId_name_key" ON "OrgRole"("orgId", "name");
ALTER TABLE "OrgRole" ADD CONSTRAINT "OrgRole_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Οι ρόλοι συστήματος για κάθε υπάρχουσα επιχείρηση
INSERT INTO "OrgRole" ("id", "orgId", "name", "permissions", "system", "locked")
SELECT 'role_owner_' || "id", "id", 'Ιδιοκτήτης', ARRAY['dashboard.view','pos.use','receipts.view','devices.manage','billing.view','users.manage'], true, true FROM "Organization"
UNION ALL
SELECT 'role_manager_' || "id", "id", 'Υπεύθυνος', ARRAY['dashboard.view','pos.use','receipts.view','devices.manage'], true, false FROM "Organization"
UNION ALL
SELECT 'role_cashier_' || "id", "id", 'Ταμίας', ARRAY['pos.use','receipts.view'], true, false FROM "Organization";

-- Οι υπάρχοντες χρήστες κρατούν τον ρόλο που είχαν
ALTER TABLE "Membership" ADD COLUMN "roleId" TEXT;
UPDATE "Membership" SET "roleId" = CASE "role" WHEN 'OWNER' THEN 'role_owner_' WHEN 'MANAGER' THEN 'role_manager_' ELSE 'role_cashier_' END || "orgId";
ALTER TABLE "Membership" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "OrgRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" DROP COLUMN "role";
DROP TYPE "Role";
