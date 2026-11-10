// Cornerstone 3D Adapters for Sonador.
// IMPORTANT: The measurement service within Sonador uses the Cornerstone 3D adapters to load
// SR data and the Classic / Legacy Cornerstone tools for creating SR instance data.

// TODO: Refactor measurement service and bindings so that the Cornerstone 3D representation
// is used throughout the SR module rather than maintaining two separate adapters for working 
// with the data.

import _ from 'lodash';

import { utilities, data as dcmData } from "dcmjs";
import { adaptersSR as c3dAdaptersSR, helpers as c3dSrHelpers } from '@cornerstonejs/adapters';

import Enums from '../../measurements/enums';
import { readFindingCode } from '../TID300/DICOMReferencedSOPInstanceFinding';
import { asArray, conceptNameValue, firstItem } from '../utils/codedConcept';
import { encodingWarnings, handlePointsOf, imageToPatient, isPlane } from '../utils/angleGeometry';
import { findImageForPoints, planeFromModule } from '../readOnly/planeGeometry';

const { TID300Measurement } = utilities.TID300;
const {
  BaseAdapter3D, MeasurementReport: LibraryMeasurementReport, Angle: LibraryAngle, CobbAngle: LibraryCobbAngle,
} = c3dAdaptersSR.Cornerstone3D;
const { DicomMetaDictionary } = dcmData;

const { SREnums, Cornerstone3D } = Enums;


const DICOMSR_SERIES_TAG = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;

const trackingUID = MeasurementGroup => {
  const item = asArray(MeasurementGroup.ContentSequence).find(contentItem =>
    conceptNameValue(contentItem) === SREnums.CodeNameCodeSequenceValues.TrackingUniqueIdentifier);
  return item && item.UID;
};


class DICOMSRSeriesTagTool extends BaseAdapter3D {
  // DICOM SR adapter class which for saving/parsing series tag data

  static {
    this.init(DICOMSR_SERIES_TAG, TID300Measurement);

    // Register using Cornerstone 1.x name so the tool is used to load those annotations
    this.registerLegacy();
  }

  static getMeasurementData(MeasurementGroup, 
      sopInstanceUIDToImageIdMap, metadata, trackingIdentifierValue, options) {
    // Retrieve the DICOM SR Series Tag Data from the provided Measurement Group

    options = options || {};
    _.defaults(options, {
      isReadOnly: true,
      isLocked: true,
    });
    
    // Retrieve finding group, base tool state, and UID references
    const {
      findingGroup, findings, state, ReferencedSOPSequence, ReferencedSOPInstanceUID, ReferencedFrameNumber, referencedImageId,
    } = Cornerstone3D.sr.measurementReport.getQualitativeEvaluationData(
      MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, this.toolType);

    const TrackingUniqueIdentifier = trackingUID(MeasurementGroup);
    const findingCode = readFindingCode(findingGroup, TrackingUniqueIdentifier);
    if (!findingCode) {
      throw new Error('Unable to parse DICOM series tag data, invalid ConceptCodeSequence');
    }
    const { value, text, scheme, schemeVersion } = findingCode;

    // Add data to tool/annotation state
    _.extend(state.annotation.data, { value, text });
    state.annotation.metadata.scheme = scheme;
    state.annotation.metadata.schemeVersion = schemeVersion;
    state.annotation.metadata.TrackingUniqueIdentifier = TrackingUniqueIdentifier;
    state.annotation.metadata.isReadOnly = options.isReadOnly;
    state.annotation.metadata.isLocked = options.isLocked;

    console.debug('[DICOMSR:TID300:DICOMSRSeriesTagTool:getMeasurementData] toolType='+this.toolType+' state', state);
    return state;
  }

  static getTID300RepresentationArguments(tool, is3DMeasurement = false) {
    // Encode Series Tag Data as SR Instance

    throw new Error('TODO: Implement logic for encoding Series Tag as SR instance');
  }
}


// Angle and Cobb angle: the library adapters (Cobb angle representation, both tracking identifier
// prefixes; Angle reads its handles from encoded points 0, 1 and 3), completed with what the
// exchange profile needs from a hydrated measurement:
// * the image of the referenced frame, never another frame of the same instance;
// * patient points mapped from image points as DICOM defines them (angleGeometry.js), the mapping
//   the classic bridge, the writer and the Cornerstone3D mirror invert;
// * for a patient-domain (SCOORD3D) polyline, the loaded image of the polyline's Frame of
//   Reference whose plane holds all four points, so the measurement can be drawn and edited;
// * the stored value, kept as read, and the geometry it was read with (`sourceGeometry`), so an
//   unchanged re-save writes both back as they were;
// * the tracking identifier, which a re-save keeps;
// * read-only and locked: a measurement read from a stored report is listed with the saved
//   measurements and is not written again, as the read-only display marks the other tools'
//   measurements. A report not yet confirmed as stored (`options.locked` false) leaves them
//   editable.

const coordinateItemOf = group => {
  const num = asArray(group.ContentSequence).find(item => item.ValueType === 'NUM');
  const coordinates = asArray(num && num.ContentSequence)
    .find(item => item.ValueType === 'SCOORD' || item.ValueType === 'SCOORD3D');
  return { num, coordinates };
};

const graphicPoints = coordinates => {
  const size = coordinates.ValueType === 'SCOORD3D' ? 3 : 2;
  const data = Array.from(coordinates.GraphicData || [], Number);
  return _.chunk(data, size).filter(point => point.length === size);
};

function frameImageIds(sopInstanceUIDToImageIdMap, imageIdsForToolState) {
  // The library looks images up as `SOPInstanceUID:frame`. The viewer keeps the first frame's id by
  // SOP instance and every frame's id by frame number; a frame without an id stays unresolved.
  return new Proxy(sopInstanceUIDToImageIdMap, {
    get: (target, key) => {
      if (typeof key !== 'string' || key in target || !key.includes(':')) {
        return target[key];
      }
      const [SOPInstanceUID, frame] = key.split(':');
      const frames = imageIdsForToolState && imageIdsForToolState[SOPInstanceUID];
      if (frames) {
        return frames[Number(frame)];
      }
      return Number(frame) === 1 ? target[SOPInstanceUID] : undefined;
    },
  });
}

function imageCandidates(sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata) {
  // Every loaded image (each frame of a multiframe instance) with its plane
  const images = [];
  _.forEach(sopInstanceUIDToImageIdMap, (imageId, SOPInstanceUID) => {
    const frames = imageIdsForToolState && imageIdsForToolState[SOPInstanceUID];
    const ids = frames && frames.some(Boolean)
      ? frames.map((id, frameNumber) => id && { imageId: id, frameNumber }).filter(Boolean)
      : [{ imageId, frameNumber: 1 }];
    ids.forEach(({ imageId: id, frameNumber }) => images.push({ SOPInstanceUID, imageId: id, frameNumber }));
  });
  return images.map(image => {
    let module;
    try {
      module = metadata.get('imagePlaneModule', image.imageId);
    } catch (error) {
      module = undefined;
    }
    return { ...image, module, plane: planeFromModule(module) };
  });
}

function completeAngleState(adapter, state, MeasurementGroup, context) {
  const { sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked = true } = context;
  const { num, coordinates } = coordinateItemOf(MeasurementGroup);
  const { annotation } = state;
  const TrackingUniqueIdentifier = trackingUID(MeasurementGroup);
  if (!coordinates) {
    return state;
  }

  const points = graphicPoints(coordinates);
  encodingWarnings(adapter.toolType, points).forEach(message => console.warn(
    `[DICOMSR:Cornerstone3D:${adapter.toolType}] ${message} trackingUID=${TrackingUniqueIdentifier}`));

  const isPatientDomain = coordinates.ValueType === 'SCOORD3D';
  const reference = firstItem(asArray(coordinates.ContentSequence).find(item => item.ValueType === 'IMAGE')?.ReferencedSOPSequence);
  annotation.metadata.coordinateDomain = isPatientDomain ? 'patient' : 'image';

  let placement;
  if (isPatientDomain && !annotation.metadata.referencedImageId) {
    const image = findImageForPoints(imageCandidates(sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata),
      points, { FrameOfReferenceUID: coordinates.ReferencedFrameOfReferenceUID });
    if (image) {
      state.sopInstanceUid = image.SOPInstanceUID;
      annotation.metadata.referencedImageId = image.imageId;
      annotation.data.frameNumber = image.frameNumber;
      placement = { SOPInstanceUID: image.SOPInstanceUID, frameNumber: image.frameNumber };
    } else {
      console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] no loaded image of Frame of Reference `
        + `${coordinates.ReferencedFrameOfReferenceUID} holds the polyline trackingUID=${TrackingUniqueIdentifier}`);
    }
  }

  const { referencedImageId } = annotation.metadata;
  if (!isPatientDomain && referencedImageId) {
    let module;
    try {
      module = metadata.get('imagePlaneModule', referencedImageId);
    } catch (error) {
      module = undefined;
    }
    if (isPlane(module)) {
      annotation.data.handles.points = handlePointsOf(adapter.toolType, points).map(point => imageToPatient(module, point));
    }
  }

  const measuredValue = firstItem(num && num.MeasuredValueSequence);
  const storedAngle = measuredValue && !_.isNil(measuredValue.NumericValue) ? Number(measuredValue.NumericValue) : null;
  if (referencedImageId) {
    annotation.data.cachedStats = { [`imageId:${referencedImageId}`]: { angle: storedAngle } };
  }

  annotation.metadata.sourceGeometry = {
    valueType: coordinates.ValueType,
    graphicData: Array.from(coordinates.GraphicData || [], Number),
    FrameOfReferenceUID: coordinates.ReferencedFrameOfReferenceUID,
    ReferencedSOPInstanceUID: reference && reference.ReferencedSOPInstanceUID,
    ReferencedFrameNumber: reference && reference.ReferencedFrameNumber,
    // The image a patient-domain polyline was placed on
    placement,
    value: storedAngle,
  };
  annotation.metadata.TrackingUniqueIdentifier = TrackingUniqueIdentifier;
  annotation.metadata.TrackingIdentifier = trackingIdentifier;
  if (locked) {
    annotation.metadata.isReadOnly = true;
    annotation.metadata.isLocked = true;
  }
  return state;
}

function registerAngleAdapter(adapter) {
  // Replaces the library adapter of the same tool type, for every tracking identifier it accepts
  LibraryMeasurementReport.registerTool(adapter, true);
  LibraryMeasurementReport.registerTrackingIdentifier(adapter, ...adapter.trackingIdentifiers);
}

// `options.imageIdsForToolState` (SOP instance -> image id by frame number) and `options.locked` are
// passed by the Sonador report's generateToolState; the library adapters ignore them
function angleMeasurementData(adapter, LibraryAdapter, args) {
  const [MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, trackingIdentifier, options] = args;
  const imageIdsForToolState = options && options.imageIdsForToolState;
  const locked = !options || options.locked !== false;
  const state = LibraryAdapter.getMeasurementData.call(adapter, MeasurementGroup,
    frameImageIds(sopInstanceUIDToImageIdMap, imageIdsForToolState), metadata, trackingIdentifier);
  return completeAngleState(adapter, state, MeasurementGroup, {
    sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked,
  });
}


class Angle extends LibraryAngle {
  static getMeasurementData(...args) {
    return angleMeasurementData(this, LibraryAngle, args);
  }
}
registerAngleAdapter(Angle);


class CobbAngle extends LibraryCobbAngle {
  static getMeasurementData(...args) {
    return angleMeasurementData(this, LibraryCobbAngle, args);
  }
}
registerAngleAdapter(CobbAngle);


// Adapter Module

const sonadorAdaptersSR = _.extend(c3dAdaptersSR.Cornerstone3D, {
  DICOMSRSeriesTagTool,
  Angle,
  CobbAngle,
});


export default sonadorAdaptersSR;
export { sonadorAdaptersSR, DICOMSRSeriesTagTool, Angle, CobbAngle };