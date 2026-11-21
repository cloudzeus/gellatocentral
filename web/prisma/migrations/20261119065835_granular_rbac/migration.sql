/*
  Warnings:

  - You are about to drop the column `storeId` on the `Membership` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "MembershipStore" (
    "membershipId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "MembershipStore_pkey" PRIMARY KEY ("membershipId","storeId")
);

-- Μεταφορά δεδομένων: το παλιό Membership.storeId γίνεται γραμμή MembershipStore (κενό πίνακας = όλα τα καταστήματα)
INSERT INTO "MembershipStore" ("membershipId", "storeId")
SELECT "id", "storeId" FROM "Membership" WHERE "storeId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_storeId_fkey";

-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "storeId";

-- CreateTable
CREATE TABLE "OrgGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipGroup" (
    "membershipId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "MembershipGroup_pkey" PRIMARY KEY ("membershipId","groupId")
);

-- CreateTable
CREATE TABLE "StaffGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffGroupMember" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "StaffGroupMember_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "StaffStoreAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffStoreAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgGroup_orgId_name_key" ON "OrgGroup"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StaffGroup_name_key" ON "StaffGroup"("name");

-- CreateIndex
CREATE INDEX "StaffStoreAccess_userId_orgId_idx" ON "StaffStoreAccess"("userId", "orgId");

-- AddForeignKey
ALTER TABLE "OrgGroup" ADD CONSTRAINT "OrgGroup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipStore" ADD CONSTRAINT "MembershipStore_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipStore" ADD CONSTRAINT "MembershipStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipGroup" ADD CONSTRAINT "MembershipGroup_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipGroup" ADD CONSTRAINT "MembershipGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrgGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGroupMember" ADD CONSTRAINT "StaffGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGroupMember" ADD CONSTRAINT "StaffGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StaffGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffStoreAccess" ADD CONSTRAINT "StaffStoreAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffStoreAccess" ADD CONSTRAINT "StaffStoreAccess_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffStoreAccess" ADD CONSTRAINT "StaffStoreAccess_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
