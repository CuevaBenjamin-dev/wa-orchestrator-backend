/* eslint-disable @typescript-eslint/unbound-method */
import {
  IpdeAutomationMode,
  IpdeConversationStage,
  IpdeOrderItemStatus,
  IpdeOrderStatus,
  IpdePaymentStatus,
  IpdeSubjectRequestStatus,
} from '@prisma/client';
import { CatalogService } from '../../catalog/catalog.service';
import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { IpdeOrderService } from '../services/ipde-order.service';
import { IpdeConversationStateService } from '../services/ipde-conversation-state.service';
import { IpdeConversationContextService } from './ipde-conversation-context.service';

const now = new Date('2026-06-22T10:00:00.000Z');

function catalogEntry(): SubjectCatalogEntry {
  return {
    schemaVersion: 1,
    id: 'DERECHO_CIVIL',
    tenantCode: 'IPDE',
    category: 'DERECHO',
    displayName: 'Derecho Civil',
    normalizedName: 'derecho civil',
    aliases: [],
    allowedProductTypes: ['DIPLOMADO'],
    topics: Array.from({ length: 25 }, (_, index) => ({
      id: `CIVIL_${index + 1}`,
      name: `Tema civil ${index + 1}`,
      aliases: [],
      active: true,
      priority: index + 1,
    })),
    source: 'MANUAL',
    active: true,
    version: 1,
  };
}

describe('IpdeConversationContextService', () => {
  it('recovers a minimal order context and rebuilds presented lists from CatalogService', async () => {
    const state = {
      id: 'state-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      stage: IpdeConversationStage.WAITING_FOR_TOPIC_SELECTION,
      automationMode: IpdeAutomationMode.ACTIVE,
      pauseReason: null,
      pausedAt: null,
      resumedAt: null,
      stateVersion: 3,
      lastTransitionAt: now,
      activeOrderId: 'order-1',
      createdAt: now,
      updatedAt: now,
    };
    const subject = {
      id: 'subject-1',
      tenantId: 'tenant-1',
      orderId: 'order-1',
      categoryCode: 'DERECHO',
      catalogEntryId: 'DERECHO_CIVIL',
      displayName: 'Derecho Civil',
      normalizedName: 'derecho civil',
      catalogSource: 'MANUAL',
      status: IpdeSubjectRequestStatus.LIST_PRESENTED,
      listPresentedAt: now,
      selectionCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const order = {
      id: 'order-1',
      tenantId: 'tenant-1',
      conversationStateId: 'state-1',
      status: IpdeOrderStatus.DRAFT,
      paymentStatus: IpdePaymentStatus.NOT_REQUESTED,
      fullName: 'Nombre reservado',
      normalizedFullName: 'Nombre reservado',
      fullNameConfirmedAt: null,
      currencyCode: 'PEN',
      quotedAmount: null,
      quoteConfirmedAt: null,
      confirmedAt: null,
      readyForIssuanceAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      subjectRequests: [subject],
      items: [
        {
          id: 'item-1',
          tenantId: 'tenant-1',
          orderId: 'order-1',
          subjectRequestId: 'subject-1',
          catalogTopicId: 'CIVIL_1',
          topicName: 'Responsabilidad civil',
          normalizedTopicName: 'responsabilidad civil',
          productTypeCode: 'DIPLOMADO',
          issuerCode: null,
          issuerVariantCode: null,
          status: IpdeOrderItemStatus.DRAFT,
          confirmedAt: null,
          removedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const states = {
      getState: jest.fn().mockResolvedValue(state),
      getOrCreateState: jest.fn().mockResolvedValue(state),
    } as unknown as IpdeConversationStateService;
    const orders = {
      getActiveOrderAggregate: jest.fn().mockResolvedValue(order),
    } as unknown as IpdeOrderService;
    const catalog = {
      getById: jest.fn().mockResolvedValue(catalogEntry()),
    } as unknown as CatalogService;
    const service = new IpdeConversationContextService(states, orders, catalog);
    const context = await service.load({
      tenantCode: 'IPDE',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      userMessage: 'Quiero la 1',
      recentMessages: [{ role: 'ASSISTANT', content: 'Lista presentada' }],
    });
    const understanding = service.buildUnderstandingInput(context);
    expect(context.presentedLists).toHaveLength(1);
    expect(understanding.presentedTopicLists?.[0].topics).toHaveLength(25);
    expect(understanding.knownOrderContext?.selectedTopics[0]).toEqual({
      topicName: 'Responsabilidad civil',
      subjectDisplayName: 'Derecho Civil',
      productTypeCode: 'DIPLOMADO',
    });
    expect(understanding.knownOrderContext?.subjects[0]).not.toHaveProperty(
      'id',
    );
    expect(
      understanding.knownOrderContext?.selectedTopics[0],
    ).not.toHaveProperty('id');
    expect(catalog.getById).toHaveBeenCalledWith({
      tenantCode: 'IPDE',
      id: 'DERECHO_CIVIL',
    });
  });
});
