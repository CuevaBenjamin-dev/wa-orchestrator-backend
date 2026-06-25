import { IpdeConversationStage } from '@prisma/client';
import { IpdeStageTransitionPolicy } from './ipde-stage-transition.policy';

describe('IpdeStageTransitionPolicy payment review transitions', () => {
  const policy = new IpdeStageTransitionPolicy();

  it('allows payment proof review from commercial waiting stages', () => {
    for (const stage of [
      IpdeConversationStage.NEW,
      IpdeConversationStage.TOPICS_SELECTED,
      IpdeConversationStage.WAITING_FOR_PRODUCT_TYPE,
      IpdeConversationStage.WAITING_FOR_ISSUER_VARIANT,
      IpdeConversationStage.WAITING_FOR_FULL_NAME,
      IpdeConversationStage.WAITING_FOR_ORDER_CONFIRMATION,
      IpdeConversationStage.WAITING_FOR_PAYMENT,
    ]) {
      expect(
        policy.canTransition(stage, IpdeConversationStage.PAYMENT_UNDER_REVIEW),
      ).toBe(true);
    }
  });
});
