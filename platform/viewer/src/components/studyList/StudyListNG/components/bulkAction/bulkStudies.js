// The selection a bulk run will actually act on.
//
// Both bulk plans had their own copy of this, and both dialogs then rendered the RAW selection
// alongside a count derived from the de-duplicated one. A selection containing the same study twice
// therefore showed two rows under a "1 study" heading, with duplicate React keys -- the list and its
// own heading disagreeing about what was about to happen.
//
// One definition, used by the plans and by the list component, so "what is displayed" and "what is
// executed" cannot come apart.

/**
 * Drop studies a run cannot act on, and duplicates of the ones it can.
 *
 * Order-preserving, and keyed on StudyInstanceUID because that is what identifies a study to every
 * endpoint involved. A study with no UID is dropped rather than passed on: a worklist row can outlive
 * its study (see _getStudyInstanceUID), and issuing a write against `undefined` is worse than
 * skipping it.
 */
export const dedupeStudies = (studies = []) => {
  const seen = new Set();

  return (studies || []).filter((study) => {
    const uid = study?.StudyInstanceUID;

    if (!uid || seen.has(uid)) {
      return false;
    }

    seen.add(uid);
    return true;
  });
};


export default dedupeStudies;
