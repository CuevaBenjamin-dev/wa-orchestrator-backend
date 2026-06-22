import { IpdeNextRequiredFieldPolicy } from './ipde-next-required-field.policy';

describe('IpdeNextRequiredFieldPolicy', () => {
  const policy = new IpdeNextRequiredFieldPolicy();
  const complete = {
    hasCriticalClarification: false,
    hasSubjectOrTopics: true,
    hasPendingTopicList: false,
    hasSelectedTopics: true,
    allTopicsHaveProduct: true,
    allTopicsHaveIssuer: true,
    hasFullName: true,
    fullNameConfirmed: true,
  };

  it.each([
    ['hasCriticalClarification', 'CRITICAL_CLARIFICATION'],
    ['hasSubjectOrTopics', 'SUBJECT'],
    ['hasSelectedTopics', 'TOPIC_SELECTION'],
    ['allTopicsHaveProduct', 'PRODUCT_TYPE'],
    ['allTopicsHaveIssuer', 'ISSUER_VARIANT'],
    ['hasFullName', 'FULL_NAME'],
    ['fullNameConfirmed', 'FULL_NAME_CONFIRMATION'],
  ] as const)('prioritizes %s', (field, expected) => {
    const state = { ...complete };
    if (field === 'hasCriticalClarification') state[field] = true;
    else state[field] = false;
    expect(policy.getNext(state)).toBe(expected);
  });

  it('asks for order confirmation only when every prior field is complete', () => {
    expect(policy.getNext(complete)).toBe('ORDER_CONFIRMATION');
  });

  it('keeps topic selection pending even when another topic was already selected', () => {
    expect(
      policy.getNext({
        ...complete,
        hasPendingTopicList: true,
        hasSelectedTopics: true,
      }),
    ).toBe('TOPIC_SELECTION');
  });
});
