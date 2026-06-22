import { IpdeConversationStage, IpdeConversationState } from '@prisma/client';
import { SubjectCatalogEntry } from '../../catalog/domain/catalog.types';
import { IpdeOrderAggregate } from '../domain/ipde-sales.types';
import { IpdeCatalogResolutionResult } from '../catalog-resolution/ipde-catalog-resolution.types';
import { IpdeMessageExtraction } from '../understanding/ipde-understanding.types';
import {
  IpdeAppliedChange,
  IpdeConversationTurnInput,
} from './ipde-conversation-turn.schemas';
import {
  IpdeDeferredIntent,
  IpdeOutboundAction,
} from './ipde-conversation-action.schemas';

export interface IpdePresentedCatalogList {
  entry: SubjectCatalogEntry;
  subjectRequestId: string;
}

export interface IpdeConversationTurnContext {
  input: IpdeConversationTurnInput;
  state: IpdeConversationState;
  stateCreated: boolean;
  order: IpdeOrderAggregate | null;
  presentedLists: IpdePresentedCatalogList[];
}

export interface IpdeSubjectMutation {
  displayName: string;
  normalizedName: string;
  categoryCode?: string;
  catalogEntryId?: string;
  catalogSource?: string;
  markListPresented: boolean;
}

export interface IpdeItemMutation {
  topicName: string;
  normalizedTopicName: string;
  subjectNormalizedName?: string;
  catalogTopicId?: string;
}

export interface IpdeProductMutation {
  productTypeCode: string;
  appliesTo: 'ALL' | 'SUBJECT' | 'TOPIC';
  targetReference?: string;
  correctionExplicit: boolean;
}

export interface IpdeNameMutation {
  value?: string;
  confirmExisting: boolean;
  correctionExplicit: boolean;
}

export interface IpdeConversationTurnPlan {
  ensureOrder: boolean;
  subjectMutations: IpdeSubjectMutation[];
  itemMutations: IpdeItemMutation[];
  completedSubjectNames: string[];
  productMutations: IpdeProductMutation[];
  nameMutation: IpdeNameMutation | null;
  targetStage: IpdeConversationStage;
  outboundActions: IpdeOutboundAction[];
  deferredIntents: IpdeDeferredIntent[];
}

export interface IpdeTurnPlanningInput {
  context: IpdeConversationTurnContext;
  extraction: IpdeMessageExtraction;
  catalogResolution: IpdeCatalogResolutionResult | null;
}

export interface IpdeTurnPersistenceResult {
  state: IpdeConversationState;
  order: IpdeOrderAggregate | null;
  createdOrder: boolean;
  appliedChanges: IpdeAppliedChange[];
}
