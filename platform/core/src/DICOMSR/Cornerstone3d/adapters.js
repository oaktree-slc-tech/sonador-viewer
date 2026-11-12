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
import { DCMSR_MEASUREMENT_DRAWING_PLANE } from '../enums';
import { drawingPlaneProblem } from '../utils/drawingPlane';
import {
  CIRCLE_TRACKING_TOOL, MIN_RADIUS, circleGeometryItem, circleNumItems, circleOfGeometry, circleRadius, circleValues,
} from '../utils/circleGeometry';
import frameImageIds from './utils/frameImageIds';

const { TID300Measurement } = utilities.TID300;
const {
  BaseAdapter3D, MeasurementReport: LibraryMeasurementReport, Angle: LibraryAngle, CobbAngle: LibraryCobbAngle,
  Length: LibraryLength,
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


// Length, Angle and Cobb angle: the library adapters (Cobb angle representation, both tracking
// identifier prefixes; Angle reads its handles from encoded points 0, 1 and 3), completed with what
// the exchange profile needs from a hydrated measurement:
// * the image of the referenced frame, never another frame of the same instance;
// * patient points mapped from image points as DICOM defines them (angleGeometry.js), the mapping
//   the classic bridge, the writer and the Cornerstone3D mirror invert;
// * for a patient-domain (SCOORD3D) polyline, the loaded image of the polyline's Frame of
//   Reference whose plane holds all its points, so the measurement can be drawn and edited;
//   unless it has a valid Sonador-Measurement.Drawing-Plane: it was drawn off the acquired images
//   and stays an out-of-plane measurement (`outOfPlane`), whatever image holds its points. A
//   malformed Drawing-Plane is logged and treated as absent;
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

// The cached statistic each tool's stored value is shown as
const STAT_NAMES = { Length: 'length', Angle: 'angle', CobbAngle: 'angle' };

function completeMeasurementState(adapter, state, MeasurementGroup, context) {
  const { sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked = true } = context;
  const { num, coordinates } = coordinateItemOf(MeasurementGroup);
  const { annotation } = state;
  const TrackingUniqueIdentifier = trackingUID(MeasurementGroup);
  if (!coordinates) {
    return state;
  }

  const points = graphicPoints(coordinates);
  const isAngle = adapter.toolType !== 'Length';
  if (isAngle) {
    encodingWarnings(adapter.toolType, points).forEach(message => console.warn(
      `[DICOMSR:Cornerstone3D:${adapter.toolType}] ${message} trackingUID=${TrackingUniqueIdentifier}`));
  }

  const isPatientDomain = coordinates.ValueType === 'SCOORD3D';
  const reference = firstItem(asArray(coordinates.ContentSequence).find(item => item.ValueType === 'IMAGE')?.ReferencedSOPSequence);
  annotation.metadata.coordinateDomain = isPatientDomain ? 'patient' : 'image';

  // A valid Drawing-Plane keeps a patient-domain measurement off the images
  const drawingPlaneItem = asArray(num && num.ContentSequence)
    .find(item => conceptNameValue(item) === DCMSR_MEASUREMENT_DRAWING_PLANE.value);
  const drawingPlaneText = drawingPlaneItem && drawingPlaneItem.TextValue;
  const problem = isPatientDomain && drawingPlaneText !== undefined ? drawingPlaneProblem(drawingPlaneText, points) : undefined;
  if (problem) {
    console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] malformed Drawing-Plane "${drawingPlaneText}" (${problem}), `
      + `treated as absent trackingUID=${TrackingUniqueIdentifier}`);
  }
  const outOfPlane = isPatientDomain && drawingPlaneText !== undefined && !problem;
  if (outOfPlane) {
    annotation.metadata.outOfPlane = true;
  }

  let placement;
  if (isPatientDomain && !outOfPlane && !annotation.metadata.referencedImageId) {
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
      const handlePoints = isAngle ? handlePointsOf(adapter.toolType, points) : points;
      annotation.data.handles.points = handlePoints.map(point => imageToPatient(module, point));
    }
  }

  const measuredValue = firstItem(num && num.MeasuredValueSequence);
  const storedValue = measuredValue && !_.isNil(measuredValue.NumericValue) ? Number(measuredValue.NumericValue) : null;
  if (referencedImageId) {
    annotation.data.cachedStats = { [`imageId:${referencedImageId}`]: { [STAT_NAMES[adapter.toolType]]: storedValue } };
  }

  annotation.metadata.sourceGeometry = {
    valueType: coordinates.ValueType,
    graphicData: Array.from(coordinates.GraphicData || [], Number),
    FrameOfReferenceUID: coordinates.ReferencedFrameOfReferenceUID,
    ReferencedSOPInstanceUID: reference && reference.ReferencedSOPInstanceUID,
    ReferencedFrameNumber: reference && reference.ReferencedFrameNumber,
    // The image a patient-domain polyline was placed on
    placement,
    value: storedValue,
  };
  annotation.metadata.TrackingUniqueIdentifier = TrackingUniqueIdentifier;
  annotation.metadata.TrackingIdentifier = trackingIdentifier;
  if (locked) {
    annotation.metadata.isReadOnly = true;
    annotation.metadata.isLocked = true;
  }
  return state;
}

function registerAdapter(adapter) {
  // Replaces the library adapter of the same tool type, for every tracking identifier it accepts
  LibraryMeasurementReport.registerTool(adapter, true);
  LibraryMeasurementReport.registerTrackingIdentifier(adapter, ...adapter.trackingIdentifiers);
}

// `options.imageIdsForToolState` (SOP instance -> image id by frame number) and `options.locked` are
// passed by the Sonador report's generateToolState; the library adapters ignore them
function measurementData(adapter, LibraryAdapter, args) {
  const [MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, trackingIdentifier, options] = args;
  const imageIdsForToolState = options && options.imageIdsForToolState;
  const locked = !options || options.locked !== false;
  const state = LibraryAdapter.getMeasurementData.call(adapter, MeasurementGroup,
    frameImageIds(sopInstanceUIDToImageIdMap, imageIdsForToolState), metadata, trackingIdentifier);
  return completeMeasurementState(adapter, state, MeasurementGroup, {
    sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked,
  });
}


class Angle extends LibraryAngle {
  static getMeasurementData(...args) {
    return measurementData(this, LibraryAngle, args);
  }
}
registerAdapter(Angle);


class CobbAngle extends LibraryCobbAngle {
  static getMeasurementData(...args) {
    return measurementData(this, LibraryCobbAngle, args);
  }
}
registerAdapter(CobbAngle);


class Length extends LibraryLength {
  static getMeasurementData(...args) {
    return measurementData(this, LibraryLength, args);
  }
}
registerAdapter(Length);


// Circle (Cornerstone3D `CircleROI`: points[0] the center, points[1] a point on the circumference;
// utils/circleGeometry.js), from a CIRCLE (image domain), an ELLIPSE (patient domain) or the
// undefined CIRCLE SCOORD3D of stock Cornerstone3D (read with a warning: center and radius, no
// plane). The geometry is that of the first NUM item carrying one. The Area, Perimeter and Radius
// NUM items are found by code or meaning; a value the group lacks is computed from the radius. The
// stored values are kept, shown, and written back while the circle is unchanged. Placement on a
// loaded image, the Drawing-Plane rule, the tracking identity and the lock follow the angles.

const toPatient = (module, point) => imageToPatient(module, point);

function circleMeasurementState(adapter, state, MeasurementGroup, context) {
  const { sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked = true } = context;
  const groupItems = asArray(MeasurementGroup.ContentSequence);
  const { num, coordinates } = circleGeometryItem(groupItems);
  const { annotation } = state;
  const TrackingUniqueIdentifier = trackingUID(MeasurementGroup);
  if (!coordinates) {
    throw new Error(`circle group without geometry trackingUID=${TrackingUniqueIdentifier}`);
  }

  const points = graphicPoints(coordinates);
  const circle = circleOfGeometry({ ValueType: coordinates.ValueType, GraphicType: coordinates.GraphicType, points });
  if (!circle) {
    throw new Error(`${coordinates.ValueType} ${coordinates.GraphicType} is not a circle trackingUID=${TrackingUniqueIdentifier}`);
  }
  const isPatientDomain = coordinates.ValueType === 'SCOORD3D';
  if (circle.legacy) {
    console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] CIRCLE SCOORD3D (stock Cornerstone3D) read with its center `
      + `and radius, no plane trackingUID=${TrackingUniqueIdentifier}`);
  }
  const reference = firstItem(asArray(coordinates.ContentSequence).find(item => item.ValueType === 'IMAGE')?.ReferencedSOPSequence);
  annotation.metadata.coordinateDomain = isPatientDomain ? 'patient' : 'image';

  // A valid Drawing-Plane keeps a patient-domain circle off the images
  const drawingPlaneItem = asArray(num && num.ContentSequence)
    .find(item => conceptNameValue(item) === DCMSR_MEASUREMENT_DRAWING_PLANE.value);
  const drawingPlaneText = drawingPlaneItem && drawingPlaneItem.TextValue;
  const problem = isPatientDomain && drawingPlaneText !== undefined ? drawingPlaneProblem(drawingPlaneText, points) : undefined;
  if (problem) {
    console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] malformed Drawing-Plane "${drawingPlaneText}" (${problem}), `
      + `treated as absent trackingUID=${TrackingUniqueIdentifier}`);
  }
  const outOfPlane = isPatientDomain && drawingPlaneText !== undefined && !problem;
  if (outOfPlane) {
    annotation.metadata.outOfPlane = true;
  }

  let placement;
  if (isPatientDomain && !outOfPlane) {
    const image = findImageForPoints(imageCandidates(sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata),
      points, { FrameOfReferenceUID: coordinates.ReferencedFrameOfReferenceUID });
    if (image) {
      state.sopInstanceUid = image.SOPInstanceUID;
      annotation.metadata.referencedImageId = image.imageId;
      annotation.data.frameNumber = image.frameNumber;
      placement = { SOPInstanceUID: image.SOPInstanceUID, frameNumber: image.frameNumber };
    } else {
      delete annotation.metadata.referencedImageId;
      console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] no loaded image of Frame of Reference `
        + `${coordinates.ReferencedFrameOfReferenceUID} holds the circle trackingUID=${TrackingUniqueIdentifier}`);
    }
  }

  // Handle points in patient coordinates: as read in the patient domain, mapped from the image
  const { referencedImageId } = annotation.metadata;
  let module;
  if (referencedImageId) {
    try {
      module = metadata.get('imagePlaneModule', referencedImageId);
    } catch (error) {
      module = undefined;
    }
  }
  let handlePoints;
  if (isPatientDomain) {
    handlePoints = [circle.center, circle.edge];
  } else if (isPlane(module)) {
    handlePoints = [circle.center, circle.edge].map(point => toPatient(module, point));
  } else {
    handlePoints = annotation.data.handles.points;
  }
  annotation.data.handles = { ...annotation.data.handles, points: handlePoints };

  // The stored values, a missing one computed from the radius
  const stored = circleNumItems(groupItems);
  let radius = stored.radius && stored.radius.value;
  if (!_.isFinite(radius)) {
    radius = isPatientDomain ? circle.radius
      : (isPlane(module) ? circleRadius(toPatient(module, circle.center), toPatient(module, circle.edge)) : NaN);
  }
  const computed = circleValues(radius);
  const values = {
    radius,
    area: stored.area && _.isFinite(stored.area.value) ? stored.area.value : computed.area,
    perimeter: stored.perimeter && _.isFinite(stored.perimeter.value) ? stored.perimeter.value : computed.perimeter,
  };
  if (!(radius >= MIN_RADIUS)) {
    console.warn(`[DICOMSR:Cornerstone3D:${adapter.toolType}] degenerate circle (radius ${radius}) trackingUID=${TrackingUniqueIdentifier}`);
  }
  if (referencedImageId) {
    annotation.data.cachedStats = {
      [`imageId:${referencedImageId}`]: { ...values, radiusUnit: 'mm', areaUnit: 'mm\u00B2' },
    };
  }
  // The values shown while the handles are those they were read with
  annotation.data.recordValue = { values: { ...values }, points: _.cloneDeep(handlePoints) };

  annotation.metadata.sourceGeometry = {
    valueType: coordinates.ValueType,
    graphicType: coordinates.GraphicType,
    graphicData: Array.from(coordinates.GraphicData || [], Number),
    FrameOfReferenceUID: coordinates.ReferencedFrameOfReferenceUID,
    ReferencedSOPInstanceUID: reference && reference.ReferencedSOPInstanceUID,
    ReferencedFrameNumber: reference && reference.ReferencedFrameNumber,
    placement,
    values,
    value: values.radius,
  };
  annotation.metadata.TrackingUniqueIdentifier = TrackingUniqueIdentifier;
  annotation.metadata.TrackingIdentifier = trackingIdentifier;
  if (locked) {
    annotation.metadata.isReadOnly = true;
    annotation.metadata.isLocked = true;
  }
  return state;
}

class CircleROI extends BaseAdapter3D {
  static {
    this.init(CIRCLE_TRACKING_TOOL, TID300Measurement);
    this.registerLegacy();
  }

  static getMeasurementData(MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, trackingIdentifier, options) {
    const imageIdsForToolState = options && options.imageIdsForToolState;
    const locked = !options || options.locked !== false;
    const imageIds = frameImageIds(sopInstanceUIDToImageIdMap, imageIdsForToolState);
    const { state } = LibraryMeasurementReport.getSetupMeasurementData(MeasurementGroup, imageIds, metadata, this.toolType);
    state.annotation.data = { ...state.annotation.data, handles: { ...(state.annotation.data.handles || {}) } };
    return circleMeasurementState(this, state, MeasurementGroup, {
      sopInstanceUIDToImageIdMap, imageIdsForToolState, metadata, trackingIdentifier, locked,
    });
  }

  static getTID300RepresentationArguments() {
    // Circles are written by the classic adapter (SCOORD3D/adapters.js)
    throw new Error('The Cornerstone3D circle adapter does not write; the classic adapter does');
  }
}
registerAdapter(CircleROI);


// Adapter Module

const sonadorAdaptersSR = _.extend(c3dAdaptersSR.Cornerstone3D, {
  DICOMSRSeriesTagTool,
  Angle,
  CircleROI,
  // The classic tool's name, for the checks of the tools a report holds (utils/isToolSupported.js)
  CircleRoi: CircleROI,
  CobbAngle,
  Length,
});


export default sonadorAdaptersSR;
export { sonadorAdaptersSR, DICOMSRSeriesTagTool, Angle, CircleROI, CobbAngle, Length };