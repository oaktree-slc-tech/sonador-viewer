import {
  buildWorklistOperations,
  describeBulkWorklistIntent,
  summariseBulkWorklist,
} from './bulkWorklistPlan';


const study = (uid, overrides = {}) => ({
  StudyInstanceUID: uid,
  PatientName: `Patient ${uid}`,
  ...overrides,
});
const group = (id, overrides = {}) => ({ id, name: `Group ${id}`, ...overrides });
const member = (id, overrides = {}) => ({ id, first_name: 'Ada', last_name: 'Lovelace', ...overrides });

/** Form state, as worklistRequestForm would hold it. */
const form = (overrides = {}) => ({
  groupTerm: '', group: null, memberTerm: '', member: null, reason: '', procedure: '', ...overrides,
});


describe('buildWorklistOperations', () => {
  it('produces one operation per study', () => {
    const operations = buildWorklistOperations({ studies: [study('1.2.3'), study('4.5.6')] });

    expect(operations).toHaveLength(2);
    expect(operations.map((o) => o.key)).toEqual(['1.2.3', '4.5.6']);
  });

  it('de-duplicates studies so a reviewer is not asked twice for the same study', () => {
    // The worklist endpoint accepts a repeat request rather than rejecting it, so a duplicate here
    // is not caught downstream -- it simply lands in the reviewer's worklist twice.
    const operations = buildWorklistOperations({
      studies: [study('1.2.3'), study('1.2.3'), study('4.5.6')],
    });

    expect(operations).toHaveLength(2);
  });

  it('drops studies with no UID rather than issuing a request against undefined', () => {
    const operations = buildWorklistOperations({
      studies: [study('1.2.3'), { PatientName: 'No UID' }, { StudyInstanceUID: '' }],
    });

    expect(operations).toHaveLength(1);
    expect(operations[0].key).toBe('1.2.3');
  });

  it('returns an empty list for an empty or absent selection', () => {
    expect(buildWorklistOperations()).toEqual([]);
    expect(buildWorklistOperations({ studies: [] })).toEqual([]);
  });
});


describe('describeBulkWorklistIntent', () => {
  it('quotes the number of requests the run will actually issue, not the raw selection size', () => {
    // The count the dialog shows has to be the count that gets issued, or the user is agreeing to
    // something other than what happens.
    const intent = describeBulkWorklistIntent({
      studies: [study('1.2.3'), study('1.2.3'), { PatientName: 'No UID' }],
      form: form({ group: group(1), member: member(2) }),
    });

    expect(intent.total).toBe(1);
    expect(intent.summary).toBe('Ada Lovelace will be asked to review 1 study.');
  });

  it('pluralises the study count', () => {
    const intent = describeBulkWorklistIntent({
      studies: [study('a'), study('b')],
      form: form({ group: group(1), member: member(2) }),
    });

    expect(intent.summary).toBe('Ada Lovelace will be asked to review 2 studies.');
    expect(intent.detail).toBe('Requests are created in Group 1.');
  });

  it('prompts for the missing fields instead of naming a reviewer it does not have', () => {
    const intent = describeBulkWorklistIntent({ studies: [study('a')], form: form() });

    expect(intent.summary).toBe('1 study selected.');
    expect(intent.detail).toBe('Select a group and a reviewer to continue.');
  });

  it('warns that a reason is applied to every request, only when one was typed', () => {
    const withReason = describeBulkWorklistIntent({
      studies: [study('a')],
      form: form({ group: group(1), member: member(2), reason: 'Second opinion' }),
    });
    const without = describeBulkWorklistIntent({
      studies: [study('a')],
      form: form({ group: group(1), member: member(2) }),
    });

    expect(withReason.note).toMatch(/every request/);
    expect(without.note).toBeUndefined();
  });
});


describe('summariseBulkWorklist', () => {
  it('always states both numbers', () => {
    expect(summariseBulkWorklist({ created: 12, total: 12 })).toBe('12 of 12 review requests created');
    expect(summariseBulkWorklist({ created: 9, total: 12 })).toBe('9 of 12 review requests created');
    expect(summariseBulkWorklist({ created: 1, total: 1 })).toBe('1 of 1 review request created');
    expect(summariseBulkWorklist()).toBe('0 of 0 review requests created');
  });
});
