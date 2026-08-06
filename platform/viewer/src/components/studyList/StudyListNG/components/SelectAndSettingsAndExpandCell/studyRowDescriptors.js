// Pure helpers for turning a study-list table row into the identifiers and descriptors the rest of
// the study list works with.
//
// Extracted from SelectAndSettingsAndExpandCell so they can be unit-tested: they were exported from
// a component module that transitively imports cornerstone, the DICOM loaders and the whole viewer
// runtime, so a test for a two-line resolver had to boot the application. Nothing here touches
// React. The component re-exports them, so existing importers are unchanged.

import _ from 'lodash';

import { DicomMetadataStore } from '@ohif/core';


function _getStudyInstanceUID({ row, worklist=false}) {
  // Retrieve StudyInstanceUID for the row from the DicomMetadataStore
  if (!worklist) {
    return row.id;
  }

  // Attempt to retrieve StudyInstanceUID from DicomMetadataStore
  const _study = DicomMetadataStore.findStudy((_s) => {
    // Check study metdata for a worklistId which matches the row.id

    const studyMeta = (_s.getStudyMetadata() || {});
    return _.includes(studyMeta.worklistItems || [], row.id);
  });

  // Optional: a worklist row can outlive its study in the store -- most sharply after a removal,
  // where the row is still in the table until the query refetches but the study is gone. This
  // runs during RENDER (see the call in the component below), so dereferencing undefined here
  // threw a TypeError mid-render and took the whole study list down with it. Callers already
  // treat a missing UID as "skip this row".
  return _study?.StudyInstanceUID;
}


// Fields lifted off a study-list row for user-facing messages and for the Download Manager's
// display columns. Patient and study attributes only — enough for a reader to recognise the study
// without quoting a UID at them.
const DESCRIPTOR_FIELDS = [
  'PatientName',
  'PatientID',
  'StudyDescription',
  'StudyDate',
  'AccessionNumber',
  'ServiceEpisodeID',
  'modalities',
];


function _getStudyDescriptor({ row, StudyInstanceUID, studyMeta }) {
  // Human-readable descriptor for a study-list row.
  //
  // The row itself is the source of truth here: `DicomMetadataStore` holds only what the viewer
  // has loaded, and a study-list row is registered with NO metadata (see addStudy below), so
  // reading patient/study attributes from the store yields an empty object and every message
  // degrades to "Study 1.2.826...". react-table row values are `{ value, label, type }` triples,
  // so unwrap them; the store is consulted only as a fallback for a study the viewer has opened.

  const original = row?.original || {};
  const descriptor = {};

  DESCRIPTOR_FIELDS.forEach(field => {
    const cell = original[field];
    const value = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;

    if (value !== undefined && value !== null && value !== '') {
      descriptor[field] = value;
    } else if (studyMeta?.[field]) {
      descriptor[field] = studyMeta[field];
    }
  });

  return { ...descriptor, StudyInstanceUID };
}


// Series and instance counts, on top of the identification fields above. Kept OUT of
// DESCRIPTOR_FIELDS because that set feeds the archive notifications and the Download Manager's
// display columns, where a count is noise. The removal confirmation needs them, because "this
// destroys 4 series and 812 instances" is the number the user is actually being asked about.
const REMOVAL_COUNT_FIELDS = ['numberOfStudyRelatedSeries', 'numberOfStudyRelatedInstances'];


function _getRemovalDescriptor({ row, StudyInstanceUID, studyMeta }) {
  // Descriptor for the removal confirmation: identification plus what will be destroyed.
  // A count the row does not carry is omitted rather than rendered blank — see
  // describeRemoval.studyDetailLines.

  const original = row?.original || {};
  const counts = {};

  REMOVAL_COUNT_FIELDS.forEach(field => {
    const cell = original[field];
    const value = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;

    if (value !== undefined && value !== null && value !== '') {
      counts[field] = value;
    } else if (studyMeta?.[field]) {
      counts[field] = studyMeta[field];
    }
  });

  return { ..._getStudyDescriptor({ row, StudyInstanceUID, studyMeta }), ...counts };
}


export { _getStudyInstanceUID, _getStudyDescriptor, _getRemovalDescriptor };
