-- Αναζήτηση με νόημα: χρειάζεται την επέκταση pgvector στον server της βάσης
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "KbChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orgId" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sources" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "reply" TEXT NOT NULL,
    "note" TEXT,
    "confidence" TEXT NOT NULL,
    "outcome" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbChunk_sourceType_sourceId_idx" ON "KbChunk"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "KbChunk_orgId_idx" ON "KbChunk"("orgId");

-- CreateIndex
CREATE INDEX "AgentRun_ticketId_createdAt_idx" ON "AgentRun"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

