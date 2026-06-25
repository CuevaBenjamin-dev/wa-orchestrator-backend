-- CreateEnum
CREATE TYPE "IpdePaymentProofStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IGNORED');

-- CreateTable
CREATE TABLE "IpdePaymentProof" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT,
    "conversationStateId" TEXT,
    "conversationId" TEXT,
    "leadId" TEXT,
    "status" "IpdePaymentProofStatus" NOT NULL DEFAULT 'RECEIVED',
    "provider" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "providerMessageId" TEXT,
    "providerMediaId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT,
    "caption" TEXT,
    "sha256" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdePaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpdePaymentProof_tenantId_status_idx" ON "IpdePaymentProof"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IpdePaymentProof_orderId_receivedAt_idx" ON "IpdePaymentProof"("orderId", "receivedAt");

-- CreateIndex
CREATE INDEX "IpdePaymentProof_providerMessageId_idx" ON "IpdePaymentProof"("providerMessageId");

-- CreateIndex
CREATE INDEX "IpdePaymentProof_providerMediaId_idx" ON "IpdePaymentProof"("providerMediaId");

-- CreateIndex
CREATE INDEX "IpdePaymentProof_tenantId_providerMediaId_idx" ON "IpdePaymentProof"("tenantId", "providerMediaId");

-- CreateIndex
CREATE INDEX "IpdePaymentProof_conversationId_receivedAt_idx" ON "IpdePaymentProof"("conversationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IpdePaymentProof_tenantId_providerMessageId_key" ON "IpdePaymentProof"("tenantId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "IpdePaymentProof" ADD CONSTRAINT "IpdePaymentProof_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdePaymentProof" ADD CONSTRAINT "IpdePaymentProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "IpdeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdePaymentProof" ADD CONSTRAINT "IpdePaymentProof_conversationStateId_fkey" FOREIGN KEY ("conversationStateId") REFERENCES "IpdeConversationState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdePaymentProof" ADD CONSTRAINT "IpdePaymentProof_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdePaymentProof" ADD CONSTRAINT "IpdePaymentProof_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
