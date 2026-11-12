// Read-only display of a report's measurements outside the supported (hydrated) tools, after the
// Cornerstone3D parser has hydrated the supported ones. Adapted from the OHIF v3 cornerstone-dicom-sr handler: a
// measurement linked to an image (by SOP instance, or for SCOORD3D content by the nearest image
// plane in its Frame of Reference) is drawn on that image in the classic viewport and, in patient
// coordinates, in the Cornerstone3D viewports. SCOORD3D content in no image plane is drawn in the
// Cornerstone3D viewports of its Frame of Reference only.
//
// A supported-tool measurement is never displayed here, even when hydration placed nothing, and a
// measurement whose tracking UID the MeasurementApi already holds (placed by an earlier load) is
// skipped, so hydration always wins and a measurement is never shown twice.
//
// An application document (utils/srDocument.js) is displayed, never hydrated. Of its groups, only
// those with a Cornerstone tracking identifier and coordinates of a graphic type the read-only
// layer draws are drawn; the others are ignored. Its measurements are drawn in the viewports and
// are not listed in the Measurements panel. One log line per document names the groups drawn and
// the groups ignored.

import log from '../../log';
import MeasurementApi from '../../measurements/classes/MeasurementApi';

import addMeasurement from '../SCOORD3D/utils/addMeasurement';
import { findImageForPoints, planeFromInstance } from './imagePlane';
import { patientPoints } from './renderableData';
import { addSRDisplayAnnotation, renderSRDisplayAnnotations } from './srDisplayAnnotations';
import { CIRCLE_TRACKING_TOOL } from '../utils/circleGeometry';


const _instanceOf = image => {
  const data = typeof image?.getData === 'function' ? image.getData() : image;
  return data?.metadata || data;
};


function _imageCandidates(imageDisplaySets) {
  // Every image of the study's image display sets, with its plane
  const candidates = [];

  (imageDisplaySets || []).forEach(displaySet => {
    (displaySet?.images || displaySet?.instances || []).forEach(image => {
      const instance = _instanceOf(image);
      if (!instance?.SOPInstanceUID) {
        return;
      }
      candidates.push({ displaySet, instance, plane: planeFromInstance(instance) });
    });
  });

  return candidates;
}


function _imageIdFor(instance, frameNumber, { sopInstanceUIDToImageId, imageIdsForToolState }) {
  const { SOPInstanceUID } = instance;
  const frames = imageIdsForToolState?.[SOPInstanceUID];
  return (frames && frames[frameNumber || 1]) || sopInstanceUIDToImageId?.[SOPInstanceUID];
}


function _referencedSOP(measurement) {
  const reference = (measurement.coords || []).map(coord => coord?.ReferencedSOPSequence).find(Boolean);
  return Array.isArray(reference) ? reference[0] : reference;
}


function _place(measurement, candidates) {
  // The image a measurement is drawn on: the image its content references, else (SCOORD3D) the
  // image whose plane holds every point. Undefined when it lies in no image.

  const reference = _referencedSOP(measurement);
  if (reference?.ReferencedSOPInstanceUID) {
    const candidate = candidates.find(c => c.instance.SOPInstanceUID === reference.ReferencedSOPInstanceUID);
    return candidate && { candidate, frameNumber: Number(reference.ReferencedFrameNumber) || 1 };
  }

  const coords = (measurement.coords || []).filter(coord => coord?.ValueType === 'SCOORD3D');
  if (!coords.length) {
    return undefined;
  }

  const points = [].concat(...coords.map(coord => patientPoints(coord)));
  const candidate = findImageForPoints(candidates, points, {
    FrameOfReferenceUID: coords[0].ReferencedFrameOfReferenceSequence,
  });
  if (!candidate) {
    return undefined;
  }

  // Record the image on the content, as the classic read-only path does
  coords.forEach(coord => {
    coord.ReferencedSOPSequence = {
      ReferencedSOPClassUID: candidate.instance.SOPClassUID,
      ReferencedSOPInstanceUID: candidate.instance.SOPInstanceUID,
    };
  });
  return { candidate, frameNumber: 1 };
}


// Tracking identifier prefixes of the Cornerstone tools, and the graphic types the read-only layer
// draws (readOnly/renderableData.js)
const CORNERSTONE_TRACKING_PREFIXES = ['cornerstoneTools@^4.0.0:', 'Cornerstone3DTools@^0.1.0:'];
const DRAWN_GRAPHIC_TYPES = ['POINT', 'MULTIPOINT', 'POLYLINE', 'POLYGON', 'CIRCLE', 'ELLIPSE'];


/**
 * Why a group of an application document is not drawn, or undefined when it is: its tracking
 * identifier is not a Cornerstone tool's, or its coordinates are of a graphic type the read-only
 * layer does not draw. A CIRCLE in patient coordinates is not a defined SCOORD3D graphic type.
 */
function _ignoredReason(measurement) {
  const trackingIdentifier = measurement.TrackingIdentifier || '';
  if (!CORNERSTONE_TRACKING_PREFIXES.some(prefix => trackingIdentifier.startsWith(prefix))) {
    return 'not a Cornerstone tracking identifier';
  }
  const coords = (measurement.coords || []).filter(coord => coord && coord.GraphicType);
  if (!coords.length) {
    return 'no coordinates';
  }
  const undrawn = coords.find(coord => !DRAWN_GRAPHIC_TYPES.includes(coord.GraphicType)
    || (coord.ValueType === 'SCOORD3D' && coord.GraphicType === 'CIRCLE'));
  return undrawn ? `${undrawn.ValueType} ${undrawn.GraphicType} is not drawn` : undefined;
}


/**
 * The labels a read-only measurement is drawn with: its description, when it has one, else the
 * labels the report gives it (the NUM value and unit). A circle shows its radius, when its group has
 * a Radius NUM, rather than its first NUM (the area).
 */
function _displayLabels(measurement) {
  const description = measurement.description || measurement.metadata?.description;
  if (description) {
    return [{ label: description, value: '' }];
  }
  const labels = measurement.labels || [];
  const isCircle = String(measurement.TrackingIdentifier || '').split(':').pop() === CIRCLE_TRACKING_TOOL;
  const radius = isCircle && labels.find(label => String(label && label.label).toLowerCase() === 'radius');
  return radius ? [radius] : labels;
}


function _labelColor(label) {
  // A dark colour that stays the same for the same text, as overlay labels need one
  const text = `${label.label}${label.value}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return `hsla(${hash}, 70%, 30%, 1)`;
}


function _addTextLabels(measurement, candidate) {
  // A finding with no graphic is listed as overlay text on its image, as the classic path lists
  // TEXT content
  if ((measurement.coords || []).some(coord => coord?.GraphicType)) {
    return;
  }

  const { displaySet, instance } = candidate;
  if (!Array.isArray(displaySet.SRLabels)) {
    return;
  }
  (measurement.labels || []).forEach(label => {
    displaySet.SRLabels.push({
      ReferencedSOPInstanceUID: instance.SOPInstanceUID,
      labels: {
        labelCodingSchemeDesignator: '',
        valueCodingSchemeDesignator: '',
        color: _labelColor(label),
        ...label,
        visible: true,
      },
    });
  });
  measurement.isSRText = true;
}


/**
 * Display the measurements of the given SR display sets that are outside the supported tools.
 *
 * @param {object} options
 * @param {Array} options.srDisplaySets - loaded SR display sets (DisplaySetService copies)
 * @param {Array} options.imageDisplaySets - the study's image display sets
 * @param {object} options.imageIds - `{ sopInstanceUIDToImageId, imageIdsForToolState }` from
 *   buildSopInstanceImageIds: the ids the classic viewport keys its tool state by
 * @param {Set<string>} [options.excludeTrackingUIDs] - measurements that belong to hydration (a
 *   supported tool), never displayed read-only even when hydration placed nothing
 * @returns {{ placed: number, patientOnly: number, skipped: number }}
 */
export default function addReadOnlyMeasurements({
  srDisplaySets, imageDisplaySets, imageIds = {}, excludeTrackingUIDs = new Set(),
}) {
  const measurementApi = MeasurementApi.Instance;
  const candidates = _imageCandidates(imageDisplaySets);
  const summary = { placed: 0, patientOnly: 0, skipped: 0 };

  (srDisplaySets || []).forEach(srDisplaySet => {
    const application = !!srDisplaySet?.isApplicationDocument;
    const groups = { drawn: [], ignored: [] };

    (srDisplaySet?.measurements || []).forEach(measurement => {
      const group = `${measurement?.TrackingIdentifier || '(no tracking identifier)'} ${measurement?.TrackingUniqueIdentifier || ''}`.trim();
      const ignoredReason = application ? _ignoredReason(measurement || {}) : undefined;
      if (ignoredReason) {
        groups.ignored.push(`${group}: ${ignoredReason}`);
        return;
      }

      // One measurement that cannot be added is skipped; the others are still added
      try {
        if (addOne(srDisplaySet, measurement, { listed: !application })) {
          groups.drawn.push(group);
        }
      } catch (error) {
        log.warn('[DICOM-SR:addReadOnlyMeasurements] measurement skipped', measurement?.TrackingUniqueIdentifier, error);
        summary.skipped++;
      }
    });

    if (application) {
      log.info('[DICOM-SR:addReadOnlyMeasurements] application document '+srDisplaySet.SOPInstanceUID
        +': groups drawn', groups.drawn, 'groups ignored', groups.ignored);
    }
  });

  /** Add one measurement of a report, counting it in the summary; true when it is drawn */
  function addOne(srDisplaySet, measurement, { listed }) {
    const { TrackingUniqueIdentifier } = measurement || {};
    if (!TrackingUniqueIdentifier || excludeTrackingUIDs.has(TrackingUniqueIdentifier)
        || measurementApi.getMeasurementByTrackingUid(TrackingUniqueIdentifier)) {
      return false;
    }

    measurement.labels = _displayLabels(measurement);
    const placement = _place(measurement, candidates);

    if (placement) {
      const { candidate, frameNumber } = placement;
      const imageId = _imageIdFor(candidate.instance, frameNumber, imageIds);
      if (!imageId) {
        summary.skipped++;
        return false;
      }

      _addTextLabels(measurement, candidate);
      addMeasurement(measurement, imageId, candidate.instance, candidate.displaySet.displaySetInstanceUID, { listed });
      measurement.frameNumber = frameNumber;

      if (Array.isArray(srDisplaySet.referencedDisplaySets)
          && !srDisplaySet.referencedDisplaySets.includes(candidate.displaySet)) {
        srDisplaySet.referencedDisplaySets.push(candidate.displaySet);
      }
      summary.placed++;
      return true;
    }

    // Patient coordinates in no image plane: Cornerstone3D viewports only
    if (addSRDisplayAnnotation({ measurement, render: false })) {
      summary.patientOnly++;
      return true;
    }
    summary.skipped++;
    return false;
  }

  if (summary.placed) {
    measurementApi.syncMeasurementsAndToolData();
  }
  renderSRDisplayAnnotations();

  log.info('[DICOM-SR:addReadOnlyMeasurements] read-only measurements', summary);
  return summary;
}

export { addReadOnlyMeasurements, CORNERSTONE_TRACKING_PREFIXES, DRAWN_GRAPHIC_TYPES };
