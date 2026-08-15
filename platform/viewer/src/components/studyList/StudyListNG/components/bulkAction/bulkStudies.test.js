// One definition of "the selection a run acts on", used by both bulk plans and by the list the
// dialogs render.
//
// The defect it exists for: the dialogs showed the RAW selection while quoting a count derived from
// the de-duplicated one, so a selection containing the same study twice rendered two rows -- with
// duplicate React keys -- under a "1 study" heading.

import { buildShareOperations } from '../BulkShareModal/bulkSharePlan';
import { buildWorklistOperations } from '../BulkWorklistModal/bulkWorklistPlan';

import { dedupeStudies } from './bulkStudies';


const study = (uid) => ({ StudyInstanceUID: uid, PatientName: `Patient ${uid}` });
const group = (id) => ({ 'result-type': 'group', id, name: `Group ${id}` });


describe('dedupeStudies', () => {
  it('keeps the first occurrence of each study, in order', () => {
    const kept = dedupeStudies([study('a'), study('b'), study('a'), study('c')]);

    expect(kept.map((s) => s.StudyInstanceUID)).toEqual(['a', 'b', 'c']);
  });

  it('drops studies a run cannot act on', () => {
    // A worklist row can outlive its study, resolving to no UID at all.
    expect(dedupeStudies([study('a'), { PatientName: 'gone' }, { StudyInstanceUID: '' }]))
      .toHaveLength(1);
  });

  it('tolerates an absent or empty selection', () => {
    expect(dedupeStudies()).toEqual([]);
    expect(dedupeStudies(null)).toEqual([]);
    expect(dedupeStudies([])).toEqual([]);
  });
});


describe('the displayed selection is the executed selection', () => {
  // Both plans de-duplicate through the same function the study list renders through, so a count
  // taken from either side agrees with the rows on screen.
  const selection = [study('a'), study('a'), study('b'), { PatientName: 'no uid' }];

  it('matches the worklist run, one request per study', () => {
    expect(dedupeStudies(selection)).toHaveLength(2);
    expect(buildWorklistOperations({ studies: selection })).toHaveLength(2);
  });

  it('matches the share run, one policy per study and recipient', () => {
    const operations = buildShareOperations({ studies: selection, subjects: [group(1), group(2)] });

    expect(operations).toHaveLength(dedupeStudies(selection).length * 2);
  });
});
