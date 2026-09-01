// Human-readable labels for DICOM attributes.
//
// The study list gets its column and filter vocabulary from the imaging server's DICOM tag cache
// (`/cache/dcm-tags`, see useTags): each entry carries the attribute's `tag` keyword
// ("ServiceEpisodeID") and a `label`. Where that label is the server's own camel-case split of the
// keyword, a trailing acronym does not survive it -- the reported case renders as
// "Service Episode Id s" -- and the label is what the Select Columns dropdown, the filter controls
// and the table header row all show.
//
// Only that case is repaired. A label carrying anything the keyword does not is a name someone
// chose, and is passed through untouched. The rule the split gets wrong is the one that matters
// most in DICOM: a run of capitals is a word. "ID", "UID" and "SOP" stay whole, including when
// pluralised ("IDs"), and are never title-cased down to "Id".

// Word boundaries, in precedence order:
//   1. a pluralised acronym ("IDs") -- before rule 2, which would otherwise take "ID" and strand
//      the "s" as a word of its own, which is exactly the defect this module exists to fix;
//   2. a run of capitals not starting the next word ("ID", "UID", and the "SOP" of "SOPClassUID");
//   3. an ordinary capitalised word;
//   4. a lower-case word (a keyword like `numberOfStudyRelatedSeries` starts with one);
//   5. digits.
const WORD_PATTERN = /[A-Z]{2,}s(?![a-zA-Z])|[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+/g;

// What counts as a keyword we can split: letters and digits only, starting with a letter. A value
// that already contains spaces or punctuation is a name, not a keyword, and is left alone.
const KEYWORD_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Split a DICOM keyword into its words.
 *
 * @param {string} keyword e.g. "ServiceEpisodeID"
 * @returns {string[]} e.g. ["Service", "Episode", "ID"]
 */
export function splitDicomKeyword(keyword) {
  if (typeof keyword !== 'string') {
    return [];
  }
  return keyword.match(WORD_PATTERN) || [];
}

/** The label a keyword alone implies. */
function _fromKeyword(keyword) {
  const words = splitDicomKeyword(keyword);
  if (!words.length) {
    return '';
  }
  // Only the first word is case-corrected, and only its first letter: everything else is already
  // cased the way DICOM cases it, and lowering an acronym is the failure mode here.
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * True when `label` is nothing but `keyword` with spaces inserted and letters re-cased -- that is,
 * a split of the keyword rather than a name someone chose.
 *
 * This is what separates a label to repair from a label to leave alone. "Service Episode Id s" and
 * "ServiceEpisodeIDs" carry the same characters in the same order; "Referring Practice" and
 * "ReferringPhysicianName" do not. Punctuation counts as a difference, because a keyword has none.
 */
function _isSplitOfKeyword(label, keyword) {
  return label.replace(/\s+/g, '').toLowerCase() === keyword.toLowerCase();
}

/**
 * The label to show for a DICOM attribute.
 *
 * A server-supplied label is authoritative and is returned unchanged -- unless it is demonstrably
 * just a split of the keyword, in which case it is re-split here so that acronyms survive.
 *
 * @param {string} keyword the attribute's DICOM keyword ("ServiceEpisodeID")
 * @param {string} [serverLabel] the label the imaging server supplied
 * @returns {string}
 */
export function dicomTagLabel(keyword, serverLabel) {
  const hasKeyword = typeof keyword === 'string' && KEYWORD_PATTERN.test(keyword);
  const label = typeof serverLabel === 'string' ? serverLabel.trim() : '';

  if (!hasKeyword) {
    return label || (typeof keyword === 'string' ? keyword : '');
  }
  if (label && !_isSplitOfKeyword(label, keyword)) {
    return label;
  }

  return _fromKeyword(keyword) || label || keyword;
}

export default dicomTagLabel;
