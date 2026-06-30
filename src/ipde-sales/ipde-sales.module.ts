import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IpdeCatalogResolutionService } from './catalog-resolution/ipde-catalog-resolution.service';
import { IpdeFuzzyCatalogMatchService } from './catalog-resolution/ipde-fuzzy-catalog-match.service';
import { IpdeGeneratedEntryIdService } from './catalog-resolution/ipde-generated-entry-id.service';
import { IpdeGenerationLockService } from './catalog-resolution/ipde-generation-lock.service';
import { IpdeSubjectListGenerationService } from './catalog-resolution/ipde-subject-list-generation.service';
import { IpdeTopicSelectionResolutionService } from './catalog-resolution/ipde-topic-selection-resolution.service';
import { IpdeStageTransitionPolicy } from './domain/ipde-stage-transition.policy';
import { IpdeConversationStateRepository } from './repositories/ipde-conversation-state.repository';
import { IpdeOrderRepository } from './repositories/ipde-order.repository';
import { IpdeConversationStateService } from './services/ipde-conversation-state.service';
import { IpdeOrderService } from './services/ipde-order.service';
import { IpdeMessageUnderstandingService } from './understanding/ipde-message-understanding.service';
import { IpdeUnderstandingFallbackService } from './understanding/ipde-understanding-fallback.service';
import { IpdeConversationContextService } from './conversation-engine/ipde-conversation-context.service';
import { IpdeConversationPlannerService } from './conversation-engine/ipde-conversation-planner.service';
import { IpdeConversationTurnService } from './conversation-engine/ipde-conversation-turn.service';
import { IpdeNextRequiredFieldPolicy } from './conversation-engine/ipde-next-required-field.policy';
import { IpdeResponseCopyService } from './conversation-engine/ipde-response-copy.service';
import { IpdeTurnPersistenceService } from './conversation-engine/ipde-turn-persistence.service';
import { IpdeCommercialConfigModule } from './commercial-config/ipde-commercial-config.module';
import { IpdePricingModule } from './pricing/ipde-pricing.module';
import { IpdeMediaModule } from './media/ipde-media.module';
import { IpdeOutboundModule } from './outbound/ipde-outbound.module';
import { IpdeOutboundDeliveryModule } from './outbound-delivery/ipde-outbound-delivery.module';
import { IpdePaymentProofModule } from './payment-proof/ipde-payment-proof.module';

@Module({
  imports: [
    AiModule,
    CatalogModule,
    IpdeCommercialConfigModule,
    IpdePricingModule,
    IpdeMediaModule,
    IpdeOutboundModule,
    IpdeOutboundDeliveryModule,
    IpdePaymentProofModule,
  ],
  providers: [
    IpdeCatalogResolutionService,
    IpdeFuzzyCatalogMatchService,
    IpdeGeneratedEntryIdService,
    IpdeGenerationLockService,
    IpdeSubjectListGenerationService,
    IpdeTopicSelectionResolutionService,
    IpdeStageTransitionPolicy,
    IpdeConversationStateRepository,
    IpdeOrderRepository,
    IpdeConversationStateService,
    IpdeOrderService,
    IpdeUnderstandingFallbackService,
    IpdeMessageUnderstandingService,
    IpdeConversationContextService,
    IpdeConversationPlannerService,
    IpdeNextRequiredFieldPolicy,
    IpdeResponseCopyService,
    IpdeTurnPersistenceService,
    IpdeConversationTurnService,
  ],
  exports: [
    IpdeConversationStateService,
    IpdeOrderService,
    IpdeMessageUnderstandingService,
    IpdeCatalogResolutionService,
    IpdeConversationTurnService,
    IpdeOutboundModule,
    IpdeOutboundDeliveryModule,
    IpdePaymentProofModule,
  ],
})
export class IpdeSalesModule {}
