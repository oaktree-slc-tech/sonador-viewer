// Out-of-plane measurements: a Length, Angle, Cobb angle or circle held in the patient domain, with
// no image. Drawn on a view that is not an acquired image, or read from a report whose points no loaded
// image holds (or whose Drawing-Plane says so), it is a Cornerstone3D-source measurement-service
// record that holds its patient points:
//
//   { uid, toolName, points: [[x, y, z], ...] (handle order), FrameOfReferenceUID,
//     referenceStudyUID, referenceSeriesUID (the source series), isLocked, isReadOnly,
//     metadata: { outOfPlane: true, sourceSeries, drawingPlane, views, TrackingUniqueIdentifier, ... } }
//
// It is written as SCOORD3D with its Frame of Reference and no image reference. The report's
// evidence lists the instances of its source series. A held measurement whose Frame of Reference no
// loaded series shares keeps the evidence it was read with (`metadata.carriedEvidence`) and, locked
// as it is, is written again by every save, with the evidence it was read with (none when its report
// listed none).
//
// A drawing becomes one only in a view whose volume is registered as a drawing volume (the 3D
// Inspector), which names the series it shows.

// The circle's records carry its Cornerstone3D name (circleGeometry.js); the writer knows it too
const OUT_OF_PLANE_TOOLS = ['Length', 'Angle', 'CobbAngle', 'CircleROI'];

// The tool name the Cornerstone3D annotation of a Cobb angle whose lines lie in no common plane is
// kept under: no slice tool draws it (no slice view contains it), the 3D display draws it as a Cobb
// angle
const NON_PLANAR_COBB_ANGLE = 'SonadorNonPlanarCobbAngle';

// Tool state key of the patient-domain measurements of a series
const PATIENT_KEY_PREFIX = 'patient:';
const patientKeyOf = SeriesInstanceUID => `${PATIENT_KEY_PREFIX}${SeriesInstanceUID || ''}`;
const isPatientKey = key => typeof key === 'string' && key.startsWith(PATIENT_KEY_PREFIX);

/** Whether a measurement-service record is an out-of-plane measurement */
function isOutOfPlaneMeasurement(measurement) {
  return !!measurement && OUT_OF_PLANE_TOOLS.includes(measurement.toolName)
    && !!(measurement.metadata && measurement.metadata.outOfPlane);
}

/** The writer's tool data of an out-of-plane record: its patient points in handle order */
function patientToolData(measurement) {
  const metadata = measurement.metadata || {};
  return {
    uid: measurement.uid,
    _id: measurement.uid,
    toolType: measurement.toolName,
    patientPoints: (measurement.points || []).map(point => Array.from(point, Number)),
    FrameOfReferenceUID: measurement.FrameOfReferenceUID || metadata.FrameOfReferenceUID,
    TrackingUniqueIdentifier: metadata.TrackingUniqueIdentifier,
    TrackingIdentifier: metadata.TrackingIdentifier,
    finding: measurement.finding,
    findingSites: measurement.findingSites,
    metadata,
  };
}


/**
 * The loaded image series of a Frame of Reference, from a metadata store (DicomMetadataStore): an
 * out-of-plane measurement can be drawn in, and navigated to on, any of them.
 *
 * @returns {object[]} the store's series ({ SeriesInstanceUID, SeriesNumber, Modality, instances })
 */
function seriesOfFrameOfReference(FrameOfReferenceUID, store) {
  if (!FrameOfReferenceUID || !store) {
    return [];
  }
  return (store.getStudyInstanceUIDs() || [])
    .map(StudyInstanceUID => store.getStudy(StudyInstanceUID))
    .filter(Boolean)
    .flatMap(study => (study.series || []).map(series => ({ ...series, StudyInstanceUID: study.StudyInstanceUID })))
    .filter((series) => {
      // A series has one Frame of Reference: its first instance that names one
      const instance = (series.instances || []).find(candidate => candidate && candidate.FrameOfReferenceUID);
      return !!instance && instance.FrameOfReferenceUID === FrameOfReferenceUID;
    });
}

const pick = (object, keys) => keys.reduce((picked, key) => (object[key] !== undefined ? { ...picked, [key]: object[key] } : picked), {});

function heldOutOfPlaneRecord(annotationType, toolData, StudyInstanceUID) {
  // The out-of-plane measurement-service record of a hydrated patient-domain group: its points and
  // value as read (with the geometry they were read with, which a re-save writes back while
  // unchanged), its properties, locked as a measurement read from a stored report is (editable
  // while the report is not yet confirmed as stored)
  const annotation = toolData.annotation || {};
  const metadata = annotation.metadata || {};
  const data = annotation.data || {};
  const { sourceGeometry } = metadata;
  const TrackingUniqueIdentifier = metadata.TrackingUniqueIdentifier || toolData.TrackingUniqueIdentifier;

  const points = ((data.handles && data.handles.points) || []).map(point => Array.from(point, Number));
  const value = Number.isFinite(sourceGeometry.value) ? sourceGeometry.value : undefined;
  const isLength = annotationType === 'Length';
  // A circle's values (radius, area, perimeter) as read
  const isCircle = annotationType === 'CircleROI';
  const values = isCircle ? { cachedStats: { ...(sourceGeometry.values || {}) } } : (isLength ? { length: value } : { rAngle: value });
  const locked = Boolean(metadata.isLocked);
  const record = {
    toolName: annotationType,
    points,
    FrameOfReferenceUID: sourceGeometry.FrameOfReferenceUID,
    referenceStudyUID: StudyInstanceUID,
    referenceSeriesUID: metadata.sourceSeries,
    description: toolData.description || annotation.description,
    label: '',
    isLocked: locked,
    ...(isCircle ? { unit: 'mm' } : isLength ? { length: value, unit: 'mm' } : { value, unit: 'deg' }),
    data: { ...values, displayAttributes: data.displayAttributes },
    metadata: {
      ...pick(metadata, ['TrackingIdentifier', 'sourceSeries', 'drawingPlane', 'views', 'text', 'location', 'numItems', 'sourceGeometry']),
      outOfPlane: true,
      toolName: annotationType,
      FrameOfReferenceUID: sourceGeometry.FrameOfReferenceUID,
      TrackingUniqueIdentifier,
      isLocked: locked,
      isReadOnly: Boolean(metadata.isReadOnly),
    },
  };
  return record;
}

const asArray = value => (Array.isArray(value) ? value : (value ? [value] : []));

// The report's two evidence containers (PS3.3 C.17.2.3): the instance a reference is read from is
// written back into the same one
const EVIDENCE_CONTAINERS = ['CurrentRequestedProcedureEvidenceSequence', 'PertinentOtherEvidenceSequence'];
const PERTINENT_OTHER_EVIDENCE = 'PertinentOtherEvidenceSequence';

/**
 * The instances a report's evidence lists, by container and series, in the order listed:
 * [{ StudyInstanceUID, SeriesInstanceUID, evidenceContainer, instances: [{ SOPClassUID,
 * SOPInstanceUID }] }]. A series may be listed in several items (the writer lists one per instance).
 */
function reportEvidence(report) {
  const bySeries = new Map();
  EVIDENCE_CONTAINERS.forEach(evidenceContainer => asArray(report && report[evidenceContainer]).forEach(study =>
    asArray(study && study.ReferencedSeriesSequence).forEach((series) => {
      if (!series || !series.SeriesInstanceUID) {
        return;
      }
      const key = `${evidenceContainer}|${study.StudyInstanceUID}|${series.SeriesInstanceUID}`;
      if (!bySeries.has(key)) {
        bySeries.set(key, { StudyInstanceUID: study.StudyInstanceUID, SeriesInstanceUID: series.SeriesInstanceUID, evidenceContainer, instances: [] });
      }
      const { instances } = bySeries.get(key);
      asArray(series.ReferencedSOPSequence)
        .filter(item => item && item.ReferencedSOPInstanceUID
          && !instances.some(instance => instance.SOPInstanceUID === item.ReferencedSOPInstanceUID))
        .forEach(item => instances.push({ SOPClassUID: item.ReferencedSOPClassUID, SOPInstanceUID: item.ReferencedSOPInstanceUID }));
    })));
  return [...bySeries.values()].filter(series => series.instances.length);
}

/**
 * The evidence a re-save writes for a held measurement whose Frame of Reference no loaded series
 * shares, from the report it was read from (both evidence containers): the instances it lists for
 * the measurement's Source-Series; without a Source-Series, or when the report lists none for it,
 * every instance the report lists. Each instance names its own study, series and container; no
 * Source-Series or image reference is inferred. A report that lists no evidence gives none: the
 * measurement is still written again, with no evidence of its own.
 *
 * @param {object} report - the report's naturalized dataset
 * @param {object} record - the held record (heldOutOfPlaneRecord)
 * @returns {object} { StudyInstanceUID (of the first instance, else the report's), SeriesInstanceUID
 *   (of the first instance), instances: [{ StudyInstanceUID, SeriesInstanceUID, evidenceContainer,
 *   SOPClassUID, SOPInstanceUID }] }
 */
function carriedEvidenceOf(report, record) {
  const evidence = reportEvidence(report);
  const { sourceSeries } = record.metadata;
  const ofSource = sourceSeries ? evidence.filter(series => series.SeriesInstanceUID === sourceSeries) : [];
  const carried = ofSource.length ? ofSource : evidence;
  const instances = carried.flatMap(({ StudyInstanceUID, SeriesInstanceUID, evidenceContainer, instances: listed }) =>
    listed.map(instance => ({ StudyInstanceUID, SeriesInstanceUID, evidenceContainer, ...instance })));
  const [first] = instances;
  return {
    StudyInstanceUID: first ? first.StudyInstanceUID : report && report.StudyInstanceUID,
    SeriesInstanceUID: first && first.SeriesInstanceUID,
    instances,
  };
}

/**
 * Whether a held measurement is written again by a save: it was read from a report while no loaded
 * series shared its Frame of Reference, and carries the evidence it was read with (possibly none).
 */
const isCarriedForward = measurement => isOutOfPlaneMeasurement(measurement) && !!measurement.metadata.carriedEvidence;

// The volumes of the views a drawing is taken up from, by volume id
const drawingVolumes = new Map();

/**
 * Register the volume of a view whose drawings become out-of-plane measurements; returns a function
 * that removes it.
 *
 * @param {string} volumeId
 * @param {object} series - { StudyInstanceUID, SeriesInstanceUID, FrameOfReferenceUID,
 *   reducedResolution } of the volume: `reducedResolution` when it was loaded decimated
 */
function registerDrawingVolume(volumeId, series) {
  if (!volumeId || !series) {
    return () => {};
  }
  const entry = { ...series };
  drawingVolumes.set(volumeId, entry);
  return () => {
    if (drawingVolumes.get(volumeId) === entry) {
      drawingVolumes.delete(volumeId);
    }
  };
}

/** The registered series of a volume, or undefined */
const drawingVolumeOf = volumeId => (volumeId ? drawingVolumes.get(volumeId) : undefined);


export {
  NON_PLANAR_COBB_ANGLE, OUT_OF_PLANE_TOOLS, PATIENT_KEY_PREFIX, PERTINENT_OTHER_EVIDENCE, carriedEvidenceOf, drawingVolumeOf, heldOutOfPlaneRecord,
  isCarriedForward, isOutOfPlaneMeasurement, isPatientKey, patientKeyOf, patientToolData, registerDrawingVolume,
  seriesOfFrameOfReference,
};
