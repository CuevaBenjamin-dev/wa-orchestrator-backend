-- CreateEnum
CREATE TYPE "IpdeConversationStage" AS ENUM ('NEW', 'UNDERSTANDING_REQUEST', 'WAITING_FOR_SUBJECT', 'TOPIC_LIST_READY', 'WAITING_FOR_TOPIC_SELECTION', 'TOPICS_SELECTED', 'WAITING_FOR_PRODUCT_TYPE', 'WAITING_FOR_ISSUER_VARIANT', 'WAITING_FOR_FULL_NAME', 'WAITING_FOR_ORDER_CONFIRMATION', 'WAITING_FOR_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'HUMAN_TAKEOVER', 'READY_FOR_ISSUANCE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "IpdeAutomationMode" AS ENUM ('ACTIVE', 'PAUSED_HUMAN', 'DISABLED');

-- CreateEnum
CREATE TYPE "IpdeOrderStatus" AS ENUM ('DRAFT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'AWAITING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'READY_FOR_ISSUANCE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IpdePaymentStatus" AS ENUM ('NOT_REQUESTED', 'AWAITING_PROOF', 'PROOF_RECEIVED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IpdeSubjectRequestStatus" AS ENUM ('REQUESTED', 'LIST_PRESENTED', 'SELECTION_COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IpdeOrderItemStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REMOVED');

-- CreateTable
CREATE TABLE "IpdeConversationState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stage" "IpdeConversationStage" NOT NULL DEFAULT 'NEW',
    "automationMode" "IpdeAutomationMode" NOT NULL DEFAULT 'ACTIVE',
    "pauseReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "lastTransitionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdeConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdeOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationStateId" TEXT NOT NULL,
    "status" "IpdeOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "IpdePaymentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "fullName" TEXT,
    "normalizedFullName" TEXT,
    "fullNameConfirmedAt" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL DEFAULT 'PEN',
    "quotedAmount" DECIMAL(12,2),
    "quoteConfirmedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "readyForIssuanceAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdeSubjectRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "categoryCode" TEXT,
    "catalogEntryId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "catalogSource" TEXT,
    "status" "IpdeSubjectRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "listPresentedAt" TIMESTAMP(3),
    "selectionCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdeSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdeOrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subjectRequestId" TEXT,
    "catalogTopicId" TEXT,
    "topicName" TEXT NOT NULL,
    "normalizedTopicName" TEXT NOT NULL,
    "productTypeCode" TEXT,
    "issuerCode" TEXT,
    "issuerVariantCode" TEXT,
    "status" "IpdeOrderItemStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdeOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpdeConversationState_conversationId_key" ON "IpdeConversationState"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdeConversationState_activeOrderId_key" ON "IpdeConversationState"("activeOrderId");

-- CreateIndex
CREATE INDEX "IpdeConversationState_tenantId_stage_idx" ON "IpdeConversationState"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "IpdeConversationState_tenantId_automationMode_idx" ON "IpdeConversationState"("tenantId", "automationMode");

-- CreateIndex
CREATE INDEX "IpdeConversationState_leadId_idx" ON "IpdeConversationState"("leadId");

-- CreateIndex
CREATE INDEX "IpdeOrder_tenantId_status_idx" ON "IpdeOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IpdeOrder_conversationStateId_createdAt_idx" ON "IpdeOrder"("conversationStateId", "createdAt");

-- CreateIndex
CREATE INDEX "IpdeOrder_paymentStatus_idx" ON "IpdeOrder"("paymentStatus");

-- CreateIndex
CREATE INDEX "IpdeSubjectRequest_tenantId_normalizedName_idx" ON "IpdeSubjectRequest"("tenantId", "normalizedName");

-- CreateIndex
CREATE INDEX "IpdeSubjectRequest_orderId_status_idx" ON "IpdeSubjectRequest"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IpdeSubjectRequest_orderId_normalizedName_key" ON "IpdeSubjectRequest"("orderId", "normalizedName");

-- CreateIndex
CREATE INDEX "IpdeOrderItem_tenantId_status_idx" ON "IpdeOrderItem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IpdeOrderItem_orderId_idx" ON "IpdeOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "IpdeOrderItem_subjectRequestId_idx" ON "IpdeOrderItem"("subjectRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdeOrderItem_orderId_normalizedTopicName_key" ON "IpdeOrderItem"("orderId", "normalizedTopicName");

-- AddForeignKey
ALTER TABLE "IpdeConversationState" ADD CONSTRAINT "IpdeConversationState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeConversationState" ADD CONSTRAINT "IpdeConversationState_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeConversationState" ADD CONSTRAINT "IpdeConversationState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeConversationState" ADD CONSTRAINT "IpdeConversationState_activeOrderId_fkey" FOREIGN KEY ("activeOrderId") REFERENCES "IpdeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOrder" ADD CONSTRAINT "IpdeOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOrder" ADD CONSTRAINT "IpdeOrder_conversationStateId_fkey" FOREIGN KEY ("conversationStateId") REFERENCES "IpdeConversationState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeSubjectRequest" ADD CONSTRAINT "IpdeSubjectRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeSubjectRequest" ADD CONSTRAINT "IpdeSubjectRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "IpdeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOrderItem" ADD CONSTRAINT "IpdeOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOrderItem" ADD CONSTRAINT "IpdeOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "IpdeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdeOrderItem" ADD CONSTRAINT "IpdeOrderItem_subjectRequestId_fkey" FOREIGN KEY ("subjectRequestId") REFERENCES "IpdeSubjectRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
