import { IpdeGeneratedEntryIdService } from './ipde-generated-entry-id.service';

describe('IpdeGeneratedEntryIdService', () => {
  const service = new IpdeGeneratedEntryIdService();

  it('returns stable IDs for the same normalized subject', () => {
    expect(service.subjectId('andrologia')).toBe(
      service.subjectId('andrologia'),
    );
  });

  it('returns different IDs for different subjects', () => {
    expect(service.subjectId('derecho civil')).not.toBe(
      service.subjectId('derecho penal'),
    );
  });

  it('creates schema-compatible topic IDs', () => {
    const subjectId = service.subjectId('educacion inicial');
    expect(service.topicId(subjectId, 1)).toMatch(/_TOPIC_01$/);
    expect(service.topicId(subjectId, 25)).toMatch(/_TOPIC_25$/);
    expect(() => service.topicId(subjectId, 26)).toThrow(RangeError);
  });
});
