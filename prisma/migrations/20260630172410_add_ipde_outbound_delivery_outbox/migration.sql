-- CreateEnum
CREATE TYPE "IpdeOutboundDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateTable
CREATE TABLE "IpdeOutboundDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leadId" TEXT,
    "orderId" TEXT,
    "inboundMessageId" TEXT,
    "inboundExternalId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "IpdeOutboundDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdeOutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpdeOutboundDelivery_tenantId_status_scheduledAt_idx" ON "IpdeOutboundDelivery"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "IpdeOutboundDelivery_conversationId_createdAt_idx" ON "IpdeOutboundDelivery"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "IpdeOutboundDelivery_inboundExternalId_idx" ON "IpdeOutboundDelivery"("inboundExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdeOutboundDelivery_tenantId_inboundExternalId_sequence_key" ON "IpdeOutboundDelivery"("tenantId", "inboundExternalId", "sequence");

-- AddForeignKey
ALTER TABLE "IpdeOutboundDelivery" ADD CONSTRAINT "IpdeOutboundDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOutboundDelivery" ADD CONSTRAINT "IpdeOutboundDelivery_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOutboundDelivery" ADD CONSTRAINT "IpdeOutboundDelivery_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
