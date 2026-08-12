import {
  buildShareOperations,
  describeBulkShareIntent,
  describeSubject,
  isUserSubject,
  subjectKeyOf,
  summariseBulkShare,
  summarisePermissions,
} from './bulkSharePlan';


const study = (uid, overrides = {}) => ({ StudyInstanceUID: uid, PatientName: `Patient ${uid}`, ...overrides });
const group = (id, overrides = {}) => ({ 'result-type': 'group', id, name: `Group ${id}`, ...overrides });
const user = (id, overrides = {}) => ({ 'result-type': 'user', id, first_name: 'Ada', last_name: 'Lovelace', ...overrides });


describe('subjectKeyOf', () => {
  it('separates a user and a group sharing an id', () => {
    expect(subjectKeyOf(user(3))).toBe('user:3');
    expect(subjectKeyOf(group(3))).toBe('group:3');
  });

  it('treats anything that is not explicitly a user as a group', () => {
    expect(subjectKeyOf({ id: 1 })).toBe('group:1');
  });
});


describe('isUserSubject / describeSubject', () => {
  it('names a user by full name, falling back through username and email', () => {
    expect(isUserSubject(user(1))).toBe(true);
    expect(describeSubject(user(1))).toBe('Ada Lovelace');
    expect(describeSubject(user(1, { first_name: undefined, last_name: undefined, username: 'ada' }))).toBe('ada');
    expect(
      describeSubject(user(1, { first_name: undefined, last_name: undefined, email: 'ada@example.org' }))
    ).toBe('ada@example.org');
  });

  it('names a group by name and never returns undefined', () => {
    expect(describeSubject(group(2))).toBe('Group 2');
    expect(describeSubject({ 'result-type': 'group', id: 5, name: undefined })).toBe('Group 5');
    expect(describeSubject(user(9, { first_name: undefined, last_name: undefined }))).toBe('User 9');
  });
});


describe('buildShareOperations', () => {
  it('produces one operation per study/recipient pair', () => {
    const operations = buildShareOperations({
      studies: [study('1.2.3'), study('4.5.6')],
      subjects: [group(1), user(2)],
    });

    expect(operations).toHaveLength(4);
  });

  it('orders study-major so progress walks the selection', () => {
    const operations = buildShareOperations({
      studies: [study('a'), study('b')],
      subjects: [group(1), group(2)],
    });

    expect(operations.map((o) => `${o.study.StudyInstanceUID}/${o.subject.id}`)).toEqual([
      'a/1', 'a/2', 'b/1', 'b/2',
    ]);
  });

  it('drops duplicate recipients so the count matches what is issued', () => {
    const operations = buildShareOperations({
      studies: [study('a')],
      subjects: [group(1), group(1), user(1)],
    });

    expect(operations).toHaveLength(2);
  });

  it('drops duplicate studies so a repeated selection does not double every write', () => {
    // The reported defect: every policy was POSTed twice, the first creating it and the second
    // rejected by the gateway as a duplicate.
    const operations = buildShareOperations({
      studies: [study('a'), study('a'), study('b')],
      subjects: [group(1), group(2)],
    });

    expect(operations).toHaveLength(4);
    expect(operations.filter((o) => o.study.StudyInstanceUID === 'a')).toHaveLength(2);
  });

  it('never emits the same study/recipient pair twice, however dirty the inputs', () => {
    const operations = buildShareOperations({
      studies: [study('a'), study('a'), study('a')],
      subjects: [group(1), group(1)],
    });

    expect(operations).toHaveLength(1);
    expect(new Set(operations.map((o) => o.key)).size).toBe(1);
  });

  it('skips a row carrying no StudyInstanceUID', () => {
    // A worklist row can outlive its study; callers already treat a missing UID as "skip".
    const operations = buildShareOperations({
      studies: [study('a'), { PatientName: 'orphan' }],
      subjects: [group(1)],
    });

    expect(operations).toHaveLength(1);
  });

  it('gives every operation a unique key', () => {
    const operations = buildShareOperations({
      studies: [study('a'), study('b')],
      subjects: [group(1), user(1)],
    });

    expect(new Set(operations.map((o) => o.key)).size).toBe(operations.length);
  });

  it('returns nothing when either side of the pairing is empty', () => {
    expect(buildShareOperations({ studies: [study('a')], subjects: [] })).toEqual([]);
    expect(buildShareOperations({ studies: [], subjects: [group(1)] })).toEqual([]);
    expect(buildShareOperations()).toEqual([]);
  });
});


describe('summarisePermissions', () => {
  it('lists the granted permissions in presentation order', () => {
    expect(summarisePermissions({ View: true, ACL: true, Modify: false })).toBe('View, Manage ACL');
  });

  it('says so when nothing is granted', () => {
    // Under overwrite semantics this is a real, destructive choice, not an empty state.
    expect(summarisePermissions({})).toBe('No permissions');
  });
});


describe('describeBulkShareIntent', () => {
  it('states studies, recipients and the resulting policy count', () => {
    const intent = describeBulkShareIntent({
      studies: [study('a'), study('b'), study('c')],
      subjects: [group(1), group(2)],
      permissions: { View: true },
    });

    expect(intent.summary).toBe('View will be granted to 2 recipients on 3 studies.');
    expect(intent.detail).toBe('This writes 6 access policies.');
    expect(intent.total).toBe(6);
  });

  it('singularises a one-study, one-recipient run', () => {
    const intent = describeBulkShareIntent({
      studies: [study('a')],
      subjects: [group(1)],
      permissions: { View: true },
    });

    expect(intent.summary).toBe('View will be granted to 1 recipient on 1 study.');
    expect(intent.detail).toBe('This writes 1 access policy.');
  });

  it('always warns that existing permissions are replaced', () => {
    const intent = describeBulkShareIntent({ studies: [study('a')], subjects: [group(1)] });

    expect(intent.warning).toMatch(/replaced/);
  });
});


describe('summariseBulkShare', () => {
  it('always states both numbers', () => {
    expect(summariseBulkShare({ applied: 6, total: 6 })).toBe('6 of 6 access policies applied');
    expect(summariseBulkShare({ applied: 4, total: 6 })).toBe('4 of 6 access policies applied');
    expect(summariseBulkShare({ applied: 1, total: 1 })).toBe('1 of 1 access policy applied');
    expect(summariseBulkShare()).toBe('0 of 0 access policies applied');
  });
});
