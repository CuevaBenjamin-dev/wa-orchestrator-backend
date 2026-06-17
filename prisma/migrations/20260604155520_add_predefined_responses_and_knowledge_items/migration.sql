-- CreateEnum
CREATE TYPE "PredefinedResponseMatchType" AS ENUM ('KEYWORD', 'INTENT', 'DEFAULT');

-- CreateTable
CREATE TABLE "PredefinedResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchType" "PredefinedResponseMatchType" NOT NULL DEFAULT 'KEYWORD',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intent" TEXT,
    "response" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresHuman" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredefinedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PredefinedResponse_tenantId_isActive_idx" ON "PredefinedResponse"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "PredefinedResponse_tenantId_matchType_idx" ON "PredefinedResponse"("tenantId", "matchType");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_isActive_idx" ON "KnowledgeItem"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "KnowledgeItem_tenantId_category_idx" ON "KnowledgeItem"("tenantId", "category");

-- AddForeignKey
ALTER TABLE "PredefinedResponse" ADD CONSTRAINT "PredefinedResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
