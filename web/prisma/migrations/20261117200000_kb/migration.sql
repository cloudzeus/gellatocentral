-- CreateEnum
CREATE TYPE "KbStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "status" "KbStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceTicketId" TEXT,
    "authorName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "helpfulYes" INTEGER NOT NULL DEFAULT 0,
    "helpfulNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbVersion" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "savedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbArticle_status_internal_idx" ON "KbArticle"("status", "internal");

-- CreateIndex
CREATE INDEX "KbVersion_articleId_createdAt_idx" ON "KbVersion"("articleId", "createdAt");

-- AddForeignKey
ALTER TABLE "KbVersion" ADD CONSTRAINT "KbVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

