// Where a landmark set can be shown, and the series it is listed under, from metadata already
// loaded (a metadata store with the DicomMetadataStore interface): no request is made.
//
// Placement. A patient-domain set is placed when its Frame of Reference is that of a loaded image
// series; an image-domain set when its referenced instance is in a loaded image series, matched by SOP
// Instance UID and frame number (a frame number a single-frame instance does not have, or a
// multiframe instance referenced without one, is no match). Any other set is held, with a note.
// A series is loaded while one of the given display sets shows it (the active display sets), and is
// an image series when the cache holds an instance of an image SOP class for it; its geometry is read
// from the cache. Placement is computed on every call, so display sets added or removed are followed.
//
// Attribution. A patient-domain set goes under its Source-Series when the document references it, and
// under the document's series when it does not (with a warning); without a Source-Series, under the
// one referenced series that has its frame, else the document's series. An image-domain set goes
// under the series its instance is recorded under in the document's evidence, else the document's
// series (with a warning). A set attributed to its document's series, or to a series that is not an
// image series, is grouped under no series.

import { asArray } from '../utils/codedConcept';
import { isImage } from '../../utils/isImage';

const HELD_NOTES = Object.freeze({
  'frame-not-loaded': "No loaded series shares this measurement's frame of reference.",
  'image-not-loaded': 'The image this landmark set was placed on is not loaded.',
});

const isImageInstance = instance => Boolean(instance) && isImage(instance.SOPClassUID);
const imageInstancesOf = series => asArray(series && series.instances).filter(isImageInstance);
const isImageSeries = series => imageInstancesOf(series).length > 0;

/** The series of every study the store holds: { StudyInstanceUID, SeriesInstanceUID, instances, ... } */
function cachedSeries(store) {
  if (!store || typeof store.getStudyInstanceUIDs !== 'function') {
    return [];
  }
  return (store.getStudyInstanceUIDs() || [])
    .map(StudyInstanceUID => store.getStudy(StudyInstanceUID))
    .filter(Boolean)
    .flatMap(study => (study.series || []).map(series => ({ ...series, StudyInstanceUID: study.StudyInstanceUID })));
}

/**
 * The loaded image series: the image series of the cache that one of `displaySets` shows, each with
 * its image instances only. Without `displaySets`, every image series of the cache.
 */
function loadedImageSeries(store, displaySets) {
  const shown = displaySets
    ? new Set(asArray(displaySets).map(displaySet => displaySet && displaySet.SeriesInstanceUID).filter(Boolean))
    : undefined;
  return cachedSeries(store)
    .filter(series => !shown || shown.has(series.SeriesInstanceUID))
    .map(series => ({ ...series, instances: imageInstancesOf(series) }))
    .filter(series => series.instances.length > 0);
}

/** A series' Frame of Reference: that of its first image instance that names one */
const frameOfReferenceOf = series => {
  const instance = imageInstancesOf(series).find(candidate => candidate.FrameOfReferenceUID);
  return instance ? instance.FrameOfReferenceUID : undefined;
};

/** The loaded image series of a Frame of Reference */
function seriesOfFrame(frameOfReferenceUID, store, displaySets) {
  return frameOfReferenceUID
    ? loadedImageSeries(store, displaySets).filter(series => frameOfReferenceOf(series) === frameOfReferenceUID) : [];
}

const frameCountOf = instance => Math.max(1, Number(instance && instance.NumberOfFrames) || 1);

/** Whether an instance is the exact image a reference names: its SOP Instance UID and frame number */
function isExactImage(instance, image) {
  if (!instance || instance.SOPInstanceUID !== image.sopInstanceUID) {
    return false;
  }
  const frames = frameCountOf(instance);
  const { frameNumber } = image;
  if (frames > 1) {
    return Number.isInteger(frameNumber) && frameNumber >= 1 && frameNumber <= frames;
  }
  return frameNumber === undefined || frameNumber === 1;
}

/** The loaded image an image-domain set is on: { series, instance }, or undefined */
function imageOf(image, store, displaySets) {
  for (const series of loadedImageSeries(store, displaySets)) {
    const instance = asArray(series.instances).find(candidate => isExactImage(candidate, image));
    if (instance) {
      return { series, instance };
    }
  }
  return undefined;
}


/**
 * Where a set can be shown.
 *
 * @param {object} set - a set of readLandmarkSets
 * @param {object} store - the metadata cache (DicomMetadataStore)
 * @param {object[]} [displaySets] - the active display sets; without them, every cached series counts
 * @returns {{ placed: boolean, reason?: string, note?: string, series: object[], instance?: object }}
 *   `series`: the loaded image series it can be shown on
 */
function placementOf(set, store, displaySets) {
  if (set.domain === 'image') {
    const found = set.image && imageOf(set.image, store, displaySets);
    return found
      ? { placed: true, series: [found.series], instance: found.instance }
      : { placed: false, reason: 'image-not-loaded', note: HELD_NOTES['image-not-loaded'], series: [] };
  }
  const series = seriesOfFrame(set.frameOfReferenceUID, store, displaySets);
  return series.length
    ? { placed: true, series }
    : { placed: false, reason: 'frame-not-loaded', note: HELD_NOTES['frame-not-loaded'], series: [] };
}


/**
 * The series a document's evidence lists, with their instances: { [SeriesInstanceUID]: [SOPInstanceUID] }
 */
function evidenceOf(dataset) {
  const evidence = {};
  ['CurrentRequestedProcedureEvidenceSequence', 'PertinentOtherEvidenceSequence'].forEach(attribute => {
    asArray(dataset && dataset[attribute]).forEach(study => asArray(study.ReferencedSeriesSequence).forEach((series) => {
      if (!series.SeriesInstanceUID) {
        return;
      }
      const instances = evidence[series.SeriesInstanceUID] || (evidence[series.SeriesInstanceUID] = []);
      asArray(series.ReferencedSOPSequence).forEach((sop) => {
        if (sop.ReferencedSOPInstanceUID && !instances.includes(sop.ReferencedSOPInstanceUID)) {
          instances.push(sop.ReferencedSOPInstanceUID);
        }
      });
    }));
  });
  return evidence;
}

/**
 * The series a set is attributed to, and the image series it is grouped under.
 *
 * @param {object} set - a set of readLandmarkSets
 * @param {object} document - { SeriesInstanceUID, StudyInstanceUID, evidence } of the set's document
 * @param {object} store - the metadata store
 * @returns {{ seriesInstanceUID: string, groupSeriesInstanceUID: string|null, warning?: string }}
 */
function attributionOf(set, document, store) {
  const evidence = document.evidence || {};
  const referenced = Object.keys(evidence);
  let seriesInstanceUID = document.SeriesInstanceUID;
  let warning;

  if (set.domain === 'image') {
    const recorded = set.image && referenced.find(uid => evidence[uid].includes(set.image.sopInstanceUID));
    if (recorded) {
      seriesInstanceUID = recorded;
    } else {
      warning = 'unresolved-image-reference';
    }
  } else if (set.sourceSeries) {
    if (referenced.includes(set.sourceSeries)) {
      seriesInstanceUID = set.sourceSeries;
    } else {
      warning = 'landmark-source-series-unknown';
    }
  } else if (set.frameOfReferenceUID) {
    // The one referenced series whose loaded metadata has the set's frame
    const getSeries = uid => (store && typeof store.getSeries === 'function' ? store.getSeries(document.StudyInstanceUID, uid) : undefined);
    const ofFrame = referenced.filter(uid => frameOfReferenceOf(getSeries(uid)) === set.frameOfReferenceUID);
    if (ofFrame.length === 1) {
      [seriesInstanceUID] = ofFrame;
    }
  }

  const series = store && typeof store.getSeries === 'function' ? store.getSeries(document.StudyInstanceUID, seriesInstanceUID) : undefined;
  const groupable = seriesInstanceUID !== document.SeriesInstanceUID && (!series || isImageSeries(series));
  return { seriesInstanceUID, groupSeriesInstanceUID: groupable ? seriesInstanceUID : null, ...(warning ? { warning } : {}) };
}


export {
  attributionOf, cachedSeries, evidenceOf, frameOfReferenceOf, HELD_NOTES, imageOf, isExactImage, isImageSeries, loadedImageSeries,
  placementOf, seriesOfFrame,
};
