// How a study list column sorts.
//
// Ordering is applied by the imaging server through the `OrderBy` query parameter, not in the
// browser: the table only ever holds one page of results, so sorting the rows it has would order
// the page rather than the result set. A column is therefore sortable only when its id names a
// field the study cache is able to order on -- a DICOM header held on the patient or the study, the
// modality list aggregated onto the study row, or a worklist item's state.
//
// Every page that renders StudyListNG (All studies, Worklist, Uploads, Shared) sorts through this
// module, so the set of sortable columns is the same everywhere.

// Columns whose sort field is named differently by the API than by the table.
const COLUMN_SORT_FIELDS = {
  // The worklist's MRN column carries PatientID (0010,0020)
  mrn: 'PatientID',
  // Modalities are aggregated onto the study row from its series and ordered on that column
  modalities: 'ModalitiesInStudy',
};

// Columns which name no field the server can order on.
//
// The assigned user and group are Sonador account and group IDs which the API resolves to display
// names outside the imaging cache, so the server can only order them by an identifier that appears
// nowhere in the table. Reason for Review and Requested Procedure are free text held inside the
// worklist item's procedure block, and the series column is a count of the study's series. Asking
// the server to sort on any of them is rejected, so these columns render without a sort control.
const UNSORTABLE_COLUMN_IDS = [
  'AssignedUser',
  'GroupName',
  'ReasonForReview',
  'RequestedProcedure',
  'series',
];

/**
 * Field name the API orders by for a table column, or null when the column cannot be sorted.
 *
 * @param {string} columnId table column id
 * @returns {string|null}
 */
export function getSortField(columnId) {
  if (!columnId || UNSORTABLE_COLUMN_IDS.includes(columnId)) {
    return null;
  }

  return COLUMN_SORT_FIELDS[columnId] || columnId;
}

/**
 * Whether a column offers a sort control.
 *
 * @param {string} columnId table column id
 * @returns {boolean}
 */
export function isSortableColumn(columnId) {
  return !!getSortField(columnId);
}

/**
 * Value for the API's `OrderBy` parameter, or null when nothing sortable is selected. Descending
 * order is requested by prefixing the field with "-".
 *
 * @param {{ fieldName: string, direction: string }} sorting current table sort
 * @returns {string|null}
 */
export function getOrderByParam(sorting) {
  const field = getSortField(sorting?.fieldName);

  if (!field) {
    return null;
  }

  return `${sorting.direction === 'desc' ? '-' : ''}${field}`;
}
