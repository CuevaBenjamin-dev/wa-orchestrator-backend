import { IpdeTopicSelectionResolutionService } from './ipde-topic-selection-resolution.service';

const lists = [
  {
    subjectDisplayName: 'Derecho Civil',
    topics: [
      { position: 2, topicId: 'CIVIL_02', topicName: 'Contratos civiles' },
      { position: 7, topicId: 'CIVIL_07', topicName: 'Derecho de familia' },
    ],
  },
  {
    subjectDisplayName: 'Derecho Penal',
    topics: [
      { position: 3, topicId: 'PENAL_03', topicName: 'Teoría del delito' },
    ],
  },
];

function selection(
  rawText: string,
  subjectReference: string | null,
  selectedNumbers: number[],
) {
  return {
    rawText,
    subjectReference,
    selectedNumbers,
    selectedNames: [],
    confidence: 0.9,
  };
}

describe('IpdeTopicSelectionResolutionService', () => {
  const service = new IpdeTopicSelectionResolutionService();

  it('associates two subjects and preserves selected order', () => {
    const result = service.resolve(
      [
        selection('Civil 7 y 2', 'Civil', [7, 2]),
        selection('Penal 3', 'Derecho Penal', [3]),
      ],
      lists,
    );
    expect(result.unresolved).toHaveLength(0);
    expect(
      result.resolved[0].selectedTopics.map((topic) => topic.position),
    ).toEqual([7, 2]);
    expect(result.resolved[1].selectedTopics[0].topicName).toBe(
      'Teoría del delito',
    );
  });

  it('removes duplicate numeric selections', () => {
    const result = service.resolve(
      [selection('Civil 2, 2 y 7', 'Civil', [2, 2, 7])],
      lists,
    );
    expect(
      result.resolved[0].selectedTopics.map((topic) => topic.position),
    ).toEqual([2, 7]);
  });

  it('marks unavailable positions without inventing topics', () => {
    const result = service.resolve(
      [selection('Civil 2 y 9', 'Civil', [2, 9])],
      lists,
    );
    expect(result.unresolved[0].reason).toBe('POSITION_NOT_AVAILABLE');
    expect(result.resolved[0].selectedTopics).toHaveLength(1);
  });

  it('rejects numeric selection without a presented list', () => {
    const result = service.resolve(
      [selection('Quiero la 2', 'Civil', [2])],
      [],
    );
    expect(result.unresolved[0].reason).toBe('NO_PRESENTED_LIST');
  });

  it('rejects an unknown subject reference', () => {
    const result = service.resolve(
      [selection('Laboral 2', 'Derecho Laboral', [2])],
      lists,
    );
    expect(result.unresolved[0].reason).toBe('UNKNOWN_SUBJECT_REFERENCE');
    expect(result.resolved).toHaveLength(0);
  });

  it('detects an ambiguous short subject reference', () => {
    const result = service.resolve(
      [selection('Civil 2', 'Civil', [2])],
      [
        lists[0],
        {
          subjectDisplayName: 'Derecho Procesal Civil',
          topics: [{ position: 2, topicName: 'Proceso civil' }],
        },
      ],
    );
    expect(result.unresolved[0].reason).toBe('AMBIGUOUS_SELECTION');
  });
});
