// Cornerstone Legacy/Classic Adapters for Sonador.
// IMPORTANT: The measurement service within Sonador uses the Cornerstone 3D adapters to load
// SR data and the Classic / Legacy Cornerstone tools for creeating SR instance data.

// TODO: Refactor measurement service and bindings so that the Cornerstone 3D representation
// is used throughout the SR module rather than maintaining two separate adapters for working
// with the data.

import _ from 'lodash';

import { utilities } from "dcmjs";

import { adaptersSR as c3dAdaptersSR, helpers as c3dSrHelpers } from '@cornerstonejs/adapters';

import { Enums as SREnums } from '../enums';
import TID300 from '../TID300';
import { MeasurementReport as CornerstoneLegacyMeasurementReport } from './MeasurementReport';
import {
	ANGLE_TOOL_NAMES, calibrationOf, encodedAngle, encodedPoints, encodingWarnings, handlePointsOf, imageToPatient,
	isPlane, patientToImage,
} from '../utils/angleGeometry';
import { DEFAULT_PLANE_TOLERANCE } from '../readOnly/planeGeometry';
import {
	CIRCLE_TOOL_NAMES, CIRCLE_TRACKING_TOOL, MIN_RADIUS, circleOfGeometry, circleRadius, circleValues, ellipseOfCircle,
} from '../utils/circleGeometry';
import { drawingPlaneOf } from '../utils/drawingPlane';


const { CORNERSTONE_TOOLS_SR_TAG, CORNERSTONE_3D_TAG } = SREnums;
const {
	DICOMReferencedSOPInstanceFinding: TID300DICOMReferencedSOPInstanceFinding,
	CircleMeasurement: TID300CircleMeasurement,
	CobbAngleMeasurement: TID300CobbAngleMeasurement,
	LengthMeasurement: TID300LengthMeasurement,
} = TID300;
const { MeasurementReport: LibraryLegacyMeasurementReport } = c3dAdaptersSR.Cornerstone;


class DICOMSRSeriesTagTool {
	// DICOM SR adapter class which can be used for saving/parsing series tag data

	static getMeasurementData(MeasurementGroup) {
		// Retrieve DICOom SR Series Tag Data from the provided Measurement Group
		
		throw new Error('Cornerstone Legacy: Implement logic for retrieving measurement data');
	}

	static getTID300RepresentationArguments(tool) {
		// Encode Series Tag Data as SR instance

		// Unpack series tag values
		const { value, text, finding, findingSites } = tool;
		const { scheme, schemeVersion, TrackingUniqueIdentifier } = (tool.metadata || tool);

		if (!value || !text) {

			// Log details of invalid data to console
			const emsg = 'Unable to save DICOM series tag data, invalid value or meaning.';
			console.error(emsg+' value="'+value+'" text="'+text+'"', tool);
			
			throw new Error(emsg);
		}

		return {
			value, text, finding, findingSites,
			// The version is the tag's own; a tag without one is written without CodingSchemeVersion
			scheme: scheme || SREnums.SONADOR_CLIENT,
			schemeVersion: schemeVersion || undefined,
			trackingUniqueIdentifier: TrackingUniqueIdentifier,
			trackingIdentifierTextValue: [CORNERSTONE_TOOLS_SR_TAG, SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG].join(':'),
		};
	}
}


DICOMSRSeriesTagTool.toolType = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
DICOMSRSeriesTagTool.utilityToolType = SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
DICOMSRSeriesTagTool.TID300Representation = TID300DICOMReferencedSOPInstanceFinding;
DICOMSRSeriesTagTool.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
	// Ensure that the tracking identifier for the series tag is correct
  
  if (!TrackingIdentifier.includes(":")) {
    return false;
  }

  const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

  if (cornerstone4Tag !== CORNERSTONE_TOOLS_SR_TAG) {
  	return false;
  }

  return toolType === SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
};


CornerstoneLegacyMeasurementReport.registerTool(DICOMSRSeriesTagTool);


// Angle and Cobb angle (cornerstone-tools `Angle`: start, middle, end; `CobbAngle`: start, end,
// start2, end2). Both are written with the Cobb angle representation (angleGeometry.js).
// * A measurement hydrated from an SR whose handles and image did not change (for a patient-domain
//   group: the image and frame it was placed on, its points within placement distance of that
//   plane) is written with the points and the value it was read with.
// * Otherwise the value is computed from the patient points that are written (angleGeometry.js
//   `imageToPatient`), which needs the image's plane and pixel spacing; an image without spacing
//   that declares square pixels is measured in pixels. Without either, no value is written.

const LENGTH = 'Length';

const ANGLE_HANDLES = {
	[ANGLE_TOOL_NAMES.ANGLE]: ['start', 'middle', 'end'],
	[ANGLE_TOOL_NAMES.COBB_ANGLE]: ['start', 'end', 'start2', 'end2'],
};
const TRACKING_IDENTIFIER_PREFIXES = [CORNERSTONE_TOOLS_SR_TAG, CORNERSTONE_3D_TAG];

// Image points closer than this (pixels) are unchanged
const UNCHANGED_TOLERANCE = 1e-3;

// Reasons a tool is not written; parseMeasurementsData turns them into the save result
const REFUSAL = Object.freeze({
	INCOMPLETE: 'incomplete', DEGENERATE: 'degenerate', UNCALIBRATED: 'uncalibrated', FRAME_OF_REFERENCE: 'frame-of-reference',
	PLANE: 'plane',
});
const refusal = (code, message) => Object.assign(new Error(message), { code });

function metadataOf(metadataProvider, type, imageId) {
	try {
		return metadataProvider && imageId ? metadataProvider.get(type, imageId) : undefined;
	} catch (error) {
		return undefined;
	}
}

function sourcePoints(source) {
	const size = source.valueType === 'SCOORD3D' ? 3 : 2;
	return _.chunk(Array.from(source.graphicData || [], Number), size).filter(point => point.length === size);
}

// The handle points of a tool, from the points it is encoded with
const handlePointsOfTool = (toolType, points) => (toolType === LENGTH ? points : handlePointsOf(toolType, points));
const ENCODED_POINTS = { Length: 2, Angle: 4, CobbAngle: 4 };

function isUnchanged(toolType, source, imagePoints, { module, SOPInstanceUID, frameNumber }) {
	// True when the tool still has the handles, and sits on the image, it was hydrated with
	if (!source || !_.isFinite(source.value)) {
		return false;
	}
	const points = sourcePoints(source);
	if (points.length !== ENCODED_POINTS[toolType]) {
		return false;
	}

	let expected;
	if (source.valueType === 'SCOORD3D') {
		// The image it was placed on, and every point still within placement distance of its plane
		const { placement } = source;
		if (!isPlane(module) || module.frameOfReferenceUID !== source.FrameOfReferenceUID || !placement
				|| placement.SOPInstanceUID !== SOPInstanceUID || Number(placement.frameNumber || 1) !== Number(frameNumber || 1)
				|| points.some(point => Math.abs(distanceFromImagePlane(module, point)) > DEFAULT_PLANE_TOLERANCE)) {
			return false;
		}
		expected = handlePointsOfTool(toolType, points).map(point => patientToImage(module, point));
	} else {
		if (source.ReferencedSOPInstanceUID !== SOPInstanceUID
				|| Number(source.ReferencedFrameNumber || 1) !== Number(frameNumber || 1)) {
			return false;
		}
		expected = handlePointsOfTool(toolType, points);
	}
	return expected.length === imagePoints.length && expected.every((point, i) =>
		Math.abs(point[0] - imagePoints[i][0]) <= UNCHANGED_TOLERANCE && Math.abs(point[1] - imagePoints[i][1]) <= UNCHANGED_TOLERANCE);
}

function distanceFromImagePlane(module, point) {
	const row = Array.from(module.rowCosines, Number);
	const column = Array.from(module.columnCosines, Number);
	const normal = [row[1] * column[2] - row[2] * column[1], row[2] * column[0] - row[0] * column[2], row[0] * column[1] - row[1] * column[0]];
	const origin = Array.from(module.imagePositionPatient, Number);
	return [0, 1, 2].reduce((sum, i) => sum + (point[i] - origin[i]) * normal[i], 0);
}

const asScoord = points => points.map(([x, y, z]) => (_.isNil(z) ? { x, y } : { x, y, z }));

// The handle count of each tool, and the patient points of an out-of-plane measurement
// (utils/outOfPlane.js), which has no image: they are written as they are held, with the value they
// were read with while unchanged
const HANDLE_COUNTS = { Length: 2, Angle: 3, CobbAngle: 4 };

// The points and value an out-of-plane measurement was read with, while its handle points and Frame
// of Reference are still those (an edit computes a new value); undefined otherwise
function storedPatientGeometry(toolType, tool) {
	const source = tool.sourceGeometry || (tool.metadata && tool.metadata.sourceGeometry);
	if (!source || source.valueType !== 'SCOORD3D' || !_.isFinite(source.value)
			|| source.FrameOfReferenceUID !== tool.FrameOfReferenceUID) {
		return undefined;
	}
	const points = sourcePoints(source);
	if (points.length !== ENCODED_POINTS[toolType]) {
		return undefined;
	}
	const handlePoints = handlePointsOfTool(toolType, points);
	const same = handlePoints.length === tool.patientPoints.length && handlePoints.every((point, i) =>
		point.every((value, axis) => Math.abs(value - tool.patientPoints[i][axis]) <= UNCHANGED_PATIENT_TOLERANCE));
	return same ? { points, value: source.value } : undefined;
}

// Patient points closer than this (mm) are unchanged
const UNCHANGED_PATIENT_TOLERANCE = 1e-6;

function outOfPlanePoints(toolType, tool) {
	const points = tool.patientPoints;
	if (points.length !== HANDLE_COUNTS[toolType] || points.some(point => point.length !== 3 || !point.every(_.isFinite))) {
		throw refusal(REFUSAL.INCOMPLETE, `${toolType} is incomplete: ${HANDLE_COUNTS[toolType]} patient points are required`);
	}
	if (!tool.FrameOfReferenceUID) {
		throw refusal(REFUSAL.FRAME_OF_REFERENCE, `${toolType} has no Frame of Reference`);
	}
	return points;
}

function angleToolArguments(toolType, tool, context) {
	// TID 300 arguments of an Angle / Cobb angle tool. `context` is { imageId, metadataProvider } of
	// the image the tool was drawn on. A measurement read in the patient domain is written back in
	// it; any other is written in the image domain. Throws an error with a REFUSAL `code` when the
	// tool cannot be written.
	if (tool.patientPoints) {
		const patientPoints = outOfPlanePoints(toolType, tool);
		const stored = storedPatientGeometry(toolType, tool);
		if (stored) {
			return angleArguments(toolType, tool, {
				points: stored.points, rAngle: stored.value, use3DSpatialCoordinates: true, FrameOfReferenceUID: tool.FrameOfReferenceUID,
			});
		}
		const rAngle = encodedAngle(encodedPoints(toolType, patientPoints));
		if (!_.isFinite(rAngle)) {
			throw refusal(REFUSAL.DEGENERATE, `${toolType} has a zero-length line`);
		}
		return angleArguments(toolType, tool, {
			points: encodedPoints(toolType, patientPoints), rAngle, use3DSpatialCoordinates: true, FrameOfReferenceUID: tool.FrameOfReferenceUID,
		});
	}
	const { imageId, metadataProvider } = context || {};
	const meta = tool.metadata || {};
	const handles = tool.handles || {};
	const names = ANGLE_HANDLES[toolType];
	if (names.some(name => !handles[name] || !_.isFinite(handles[name].x) || !_.isFinite(handles[name].y))) {
		throw refusal(REFUSAL.INCOMPLETE, `${toolType} is incomplete: handles ${names.join(', ')} are required`);
	}
	// cornerstone-tools draws a Cobb angle in two steps; until the second line is placed its handles
	// hold placeholders, and the measurement is marked not complete. The tool data's own flag is the
	// live one; a nested `measurementData` copy is read only when the tool data has none.
	const complete = typeof tool.complete === 'boolean' ? tool.complete
		: tool.measurementData && tool.measurementData.complete;
	if (complete === false) {
		throw refusal(REFUSAL.INCOMPLETE, `${toolType} is incomplete: its second line was not drawn`);
	}
	const imagePoints = names.map(name => [handles[name].x, handles[name].y]);

	const module = metadataOf(metadataProvider, 'imagePlaneModule', imageId);
	const sopCommon = metadataOf(metadataProvider, 'sopCommonModule', imageId) || {};
	const frameNumber = metadataOf(metadataProvider, 'frameNumber', imageId);
	const source = tool.sourceGeometry || meta.sourceGeometry;

	let points, rAngle, use3DSpatialCoordinates, FrameOfReferenceUID;
	if (isUnchanged(toolType, source, imagePoints, { module, SOPInstanceUID: sopCommon.sopInstanceUID, frameNumber })) {
		points = sourcePoints(source);
		rAngle = source.value;
		use3DSpatialCoordinates = source.valueType === 'SCOORD3D';
		FrameOfReferenceUID = source.FrameOfReferenceUID;
	} else {
		const instance = metadataOf(metadataProvider, 'instance', imageId) || {};
		const calibration = calibrationOf(module, instance.PixelAspectRatio);
		if (!calibration) {
			throw refusal(REFUSAL.UNCALIBRATED, `${toolType} is on an image without pixel spacing (imageId=${imageId})`);
		}
		const patientPoints = calibration === 'patient' ? imagePoints.map(point => imageToPatient(module, point)) : null;

		rAngle = encodedAngle(encodedPoints(toolType, patientPoints || imagePoints));
		if (!_.isFinite(rAngle)) {
			throw refusal(REFUSAL.DEGENERATE, `${toolType} has a zero-length line`);
		}

		const domain = (source && source.valueType === 'SCOORD3D') ? 'patient' : (tool.coordinateDomain || meta.coordinateDomain);
		FrameOfReferenceUID = module && module.frameOfReferenceUID;
		use3DSpatialCoordinates = domain === 'patient' && !!patientPoints && !!FrameOfReferenceUID;
		points = encodedPoints(toolType, use3DSpatialCoordinates ? patientPoints : imagePoints);
	}

	return angleArguments(toolType, tool, { points, rAngle, use3DSpatialCoordinates, FrameOfReferenceUID });
}

function angleArguments(toolType, tool, { points, rAngle, use3DSpatialCoordinates, FrameOfReferenceUID }) {
	// The identifier read from the SR (either accepted prefix) is kept; new measurements get the
	// cornerstoneTools form
	const meta = tool.metadata || {};
	const readIdentifier = tool.TrackingIdentifier || meta.TrackingIdentifier;
	const trackingIdentifierTextValue = isAngleTrackingIdentifier(toolType, readIdentifier)
		? readIdentifier : [CORNERSTONE_TOOLS_SR_TAG, toolType].join(':');

	const [point1, point2, point3, point4] = asScoord(points);
	return {
		point1, point2, point3, point4,
		rAngle,
		use3DSpatialCoordinates,
		ReferencedFrameOfReferenceUID: use3DSpatialCoordinates ? FrameOfReferenceUID : undefined,
		trackingIdentifierTextValue,
		trackingUniqueIdentifier: tool.TrackingUniqueIdentifier || meta.TrackingUniqueIdentifier,
		finding: tool.finding,
		findingSites: tool.findingSites || [],
	};
}

// Length (cornerstone-tools `Length`: start, end). A measurement read in the patient domain is
// written back in it: with the points and value it was read with while it is unchanged, otherwise
// with the patient points of its handles and their distance. Any other is written in the image
// domain, as the Cornerstone adapter writes it.

function lengthToolArguments(tool, context) {
	if (tool.patientPoints) {
		const points = outOfPlanePoints(LENGTH, tool);
		const stored = storedPatientGeometry(LENGTH, tool);
		if (stored) {
			return lengthArguments(tool, {
				points: stored.points, distance: stored.value, use3DSpatialCoordinates: true, FrameOfReferenceUID: tool.FrameOfReferenceUID,
			});
		}
		const [a, b] = points;
		return lengthArguments(tool, {
			points, distance: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
			use3DSpatialCoordinates: true, FrameOfReferenceUID: tool.FrameOfReferenceUID,
		});
	}
	const { imageId, metadataProvider } = context || {};
	const meta = tool.metadata || {};
	const handles = tool.handles || {};
	if (['start', 'end'].some(name => !handles[name] || !_.isFinite(handles[name].x) || !_.isFinite(handles[name].y))) {
		throw refusal(REFUSAL.INCOMPLETE, 'Length is incomplete: handles start, end are required');
	}
	const imagePoints = [[handles.start.x, handles.start.y], [handles.end.x, handles.end.y]];

	const module = metadataOf(metadataProvider, 'imagePlaneModule', imageId);
	const sopCommon = metadataOf(metadataProvider, 'sopCommonModule', imageId) || {};
	const frameNumber = metadataOf(metadataProvider, 'frameNumber', imageId);
	const source = tool.sourceGeometry || meta.sourceGeometry;
	const domain = (source && source.valueType === 'SCOORD3D') ? 'patient' : (tool.coordinateDomain || meta.coordinateDomain);

	let points, distance, use3DSpatialCoordinates = false, FrameOfReferenceUID;
	if (isUnchanged(LENGTH, source, imagePoints, { module, SOPInstanceUID: sopCommon.sopInstanceUID, frameNumber })) {
		points = sourcePoints(source);
		distance = source.value;
		use3DSpatialCoordinates = source.valueType === 'SCOORD3D';
		FrameOfReferenceUID = source.FrameOfReferenceUID;
	} else if (domain === 'patient' && isPlane(module) && module.frameOfReferenceUID) {
		points = imagePoints.map(point => imageToPatient(module, point));
		const [a, b] = points;
		distance = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
		use3DSpatialCoordinates = true;
		FrameOfReferenceUID = module.frameOfReferenceUID;
	} else {
		points = imagePoints;
		distance = tool.length;
	}
	return lengthArguments(tool, { points, distance, use3DSpatialCoordinates, FrameOfReferenceUID });
}

function lengthArguments(tool, { points, distance, use3DSpatialCoordinates, FrameOfReferenceUID }) {
	const meta = tool.metadata || {};
	const readIdentifier = tool.TrackingIdentifier || meta.TrackingIdentifier;
	const [point1, point2] = asScoord(points);
	return {
		point1, point2,
		distance,
		use3DSpatialCoordinates,
		ReferencedFrameOfReferenceUID: use3DSpatialCoordinates ? FrameOfReferenceUID : undefined,
		trackingIdentifierTextValue: isAngleTrackingIdentifier(LENGTH, readIdentifier)
			? readIdentifier : [CORNERSTONE_TOOLS_SR_TAG, LENGTH].join(':'),
		trackingUniqueIdentifier: tool.TrackingUniqueIdentifier || meta.TrackingUniqueIdentifier,
		finding: tool.finding,
		findingSites: tool.findingSites || [],
	};
}

function isAngleTrackingIdentifier(toolType, TrackingIdentifier) {
	if (!TrackingIdentifier || !TrackingIdentifier.includes(':')) {
		return false;
	}
	const [prefix, identifierToolType] = TrackingIdentifier.split(':');
	return TRACKING_IDENTIFIER_PREFIXES.includes(prefix) && identifierToolType === toolType;
}

function angleMeasurementData(toolType, MeasurementGroup) {
	// cornerstone-tools state of an image-domain group (handles from the encoded points)
	const { defaultState, NUMGroup, SCOORDGroup } = LibraryLegacyMeasurementReport.getSetupMeasurementData(MeasurementGroup);
	const points = _.chunk(Array.from(SCOORDGroup.GraphicData, Number), 2);
	encodingWarnings(toolType, points).forEach(message => console.warn(`[DICOM-SR:${toolType}] ${message}`));

	const handles = _.zipObject(ANGLE_HANDLES[toolType],
		handlePointsOf(toolType, points).map(([x, y]) => ({ x, y, highlight: true, active: false })));
	handles.textBox = {
		hasMoved: false, movesIndependently: false, drawnIndependently: true, allowedOutsideImage: true, hasBoundingBox: true,
	};
	return { ...defaultState, toolType, rAngle: Number(NUMGroup.MeasuredValueSequence.NumericValue), handles };
}

function angleAdapter(toolType) {
	const adapter = class {
		static getMeasurementData(MeasurementGroup) {
			return angleMeasurementData(toolType, MeasurementGroup);
		}

		static getTID300RepresentationArguments(tool, context) {
			return angleToolArguments(toolType, tool, context);
		}
	};
	adapter.toolType = toolType;
	adapter.utilityToolType = toolType;
	adapter.TID300Representation = TID300CobbAngleMeasurement;
	adapter.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => isAngleTrackingIdentifier(toolType, TrackingIdentifier);
	return adapter;
}

const Angle = angleAdapter(ANGLE_TOOL_NAMES.ANGLE);
const CobbAngle = angleAdapter(ANGLE_TOOL_NAMES.COBB_ANGLE);

CornerstoneLegacyMeasurementReport.registerTool(Angle);
CornerstoneLegacyMeasurementReport.registerTool(CobbAngle);


const { Length: LibraryLegacyLength } = c3dAdaptersSR.Cornerstone;

class Length {
	static getMeasurementData(MeasurementGroup) {
		return LibraryLegacyLength.getMeasurementData(MeasurementGroup);
	}

	static getTID300RepresentationArguments(tool, context) {
		return lengthToolArguments(tool, context);
	}
}
Length.toolType = LENGTH;
Length.utilityToolType = LENGTH;
Length.TID300Representation = TID300LengthMeasurement;
Length.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => isAngleTrackingIdentifier(LENGTH, TrackingIdentifier);

CornerstoneLegacyMeasurementReport.registerTool(Length);


// Circle (cornerstone-tools `CircleRoi`: `start` the center, `end` a point on the circumference;
// utils/circleGeometry.js). A measurement hydrated from an SR whose handles and image did not change
// is written with the geometry and values it was read with. Otherwise:
// * image domain: a CIRCLE of the center and edge image points, with the values of the radius
//   measured in millimetres from their patient points, which needs the image's plane and pixel
//   spacing (an uncalibrated circle is refused);
// * patient domain (a measurement read in it, or an out-of-plane measurement, which holds patient
//   points): an ELLIPSE whose second diameter follows the normal of the plane it lies in (the image
//   plane, or the out-of-plane measurement's Drawing-Plane; without one it is refused).
// A radius below MIN_RADIUS is refused.

const samePoint = (a, b, tolerance) => !!a && !!b && a.length === b.length
	&& a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

function storedCircleOf(source) {
	// The circle a hydrated measurement was read with: { circle, points, values }, or undefined
	if (!source || !source.values || !_.isFinite(source.values.radius)) {
		return undefined;
	}
	const points = sourcePoints(source);
	const circle = circleOfGeometry({ ValueType: source.valueType, GraphicType: source.graphicType, points });
	return circle && !circle.legacy ? { circle, points, values: source.values } : undefined;
}

function storedCircleArguments(tool, stored, { use3DSpatialCoordinates, FrameOfReferenceUID }) {
	// The arguments of an unchanged hydrated circle, its geometry and values as read; a degenerate one
	// (kept with a warning on read) is refused as a drawn one is
	const radii = [stored.values.radius, use3DSpatialCoordinates ? stored.circle.radius : stored.values.radius];
	if (!radii.every(radius => radius >= MIN_RADIUS)) {
		throw refusal(REFUSAL.DEGENERATE, `Circle radius is below ${MIN_RADIUS} mm`);
	}
	return circleArguments(tool, { points: stored.points, values: stored.values, use3DSpatialCoordinates, FrameOfReferenceUID });
}

const circleTrackingIdentifier = (tool) => {
	const meta = tool.metadata || {};
	const readIdentifier = tool.TrackingIdentifier || meta.TrackingIdentifier;
	return isAngleTrackingIdentifier(CIRCLE_TRACKING_TOOL, readIdentifier)
		? readIdentifier : [CORNERSTONE_TOOLS_SR_TAG, CIRCLE_TRACKING_TOOL].join(':');
};

function circleArguments(tool, { points, values, use3DSpatialCoordinates, FrameOfReferenceUID }) {
	const meta = tool.metadata || {};
	return {
		points,
		values,
		use3DSpatialCoordinates,
		ReferencedFrameOfReferenceUID: use3DSpatialCoordinates ? FrameOfReferenceUID : undefined,
		trackingIdentifierTextValue: circleTrackingIdentifier(tool),
		trackingUniqueIdentifier: tool.TrackingUniqueIdentifier || meta.TrackingUniqueIdentifier,
		finding: tool.finding,
		findingSites: tool.findingSites || [],
	};
}

function patientCircleArguments(tool, center, edge, normal, FrameOfReferenceUID) {
	// The ELLIPSE of a circle of patient points in the plane of `normal`, with the values of its radius
	if (!normal) {
		throw refusal(REFUSAL.PLANE, 'Circle has no plane: its Drawing-Plane is missing or not valid');
	}
	const points = ellipseOfCircle(center, edge, normal);
	if (!points) {
		throw refusal(REFUSAL.DEGENERATE, `Circle radius is below ${MIN_RADIUS} mm`);
	}
	const radius = circleRadius(points[0], points[1]) / 2;
	return circleArguments(tool, { points, values: circleValues(radius), use3DSpatialCoordinates: true, FrameOfReferenceUID });
}

const imagePlaneNormal = (module) => {
	const row = Array.from(module.rowCosines, Number);
	const column = Array.from(module.columnCosines, Number);
	return [row[1] * column[2] - row[2] * column[1], row[2] * column[0] - row[0] * column[2], row[0] * column[1] - row[1] * column[0]];
};

function circleToolArguments(tool, context) {
	// TID 300 arguments of a circle; throws an error with a REFUSAL `code` when it cannot be written
	const meta = tool.metadata || {};
	const source = tool.sourceGeometry || meta.sourceGeometry;
	const stored = storedCircleOf(source);

	if (tool.patientPoints) {
		const points = tool.patientPoints;
		if (points.length !== 2 || points.some(point => point.length !== 3 || !point.every(_.isFinite))) {
			throw refusal(REFUSAL.INCOMPLETE, 'Circle is incomplete: its center and edge point are required');
		}
		if (!tool.FrameOfReferenceUID) {
			throw refusal(REFUSAL.FRAME_OF_REFERENCE, 'Circle has no Frame of Reference');
		}
		const [center, edge] = points;
		if (stored && source.valueType === 'SCOORD3D' && source.FrameOfReferenceUID === tool.FrameOfReferenceUID
				&& samePoint(stored.circle.center, center, UNCHANGED_PATIENT_TOLERANCE)
				&& samePoint(stored.circle.edge, edge, UNCHANGED_PATIENT_TOLERANCE)) {
			return storedCircleArguments(tool, stored, { use3DSpatialCoordinates: true, FrameOfReferenceUID: tool.FrameOfReferenceUID });
		}
		const plane = drawingPlaneOf(meta.drawingPlane, points);
		return patientCircleArguments(tool, center, edge, plane && plane.normal, tool.FrameOfReferenceUID);
	}

	const { imageId, metadataProvider } = context || {};
	const handles = tool.handles || {};
	if (['start', 'end'].some(name => !handles[name] || !_.isFinite(handles[name].x) || !_.isFinite(handles[name].y))) {
		throw refusal(REFUSAL.INCOMPLETE, 'Circle is incomplete: handles start, end are required');
	}
	const imagePoints = [[handles.start.x, handles.start.y], [handles.end.x, handles.end.y]];
	const module = metadataOf(metadataProvider, 'imagePlaneModule', imageId);
	const sopCommon = metadataOf(metadataProvider, 'sopCommonModule', imageId) || {};
	const frameNumber = metadataOf(metadataProvider, 'frameNumber', imageId);

	if (stored) {
		// Read in the image domain on this image and frame, or in the patient domain on the plane of
		// this image (where it was placed), with the same center and edge point
		const onImage = source.valueType === 'SCOORD'
			&& source.ReferencedSOPInstanceUID === sopCommon.sopInstanceUID
			&& Number(source.ReferencedFrameNumber || 1) === Number(frameNumber || 1)
			&& stored.points.every((point, i) => samePoint(point, imagePoints[i], UNCHANGED_TOLERANCE));
		const placement = source.placement || {};
		const onPlane = source.valueType === 'SCOORD3D' && isPlane(module)
			&& module.frameOfReferenceUID === source.FrameOfReferenceUID
			&& placement.SOPInstanceUID === sopCommon.sopInstanceUID && Number(placement.frameNumber || 1) === Number(frameNumber || 1)
			&& [stored.circle.center, stored.circle.edge].every((point, i) =>
				samePoint(patientToImage(module, point), imagePoints[i], UNCHANGED_TOLERANCE));
		if (onImage || onPlane) {
			return storedCircleArguments(tool, stored, {
				use3DSpatialCoordinates: source.valueType === 'SCOORD3D', FrameOfReferenceUID: source.FrameOfReferenceUID,
			});
		}
	}

	if (!isPlane(module)) {
		throw refusal(REFUSAL.UNCALIBRATED, `Circle is on an image without pixel spacing (imageId=${imageId})`);
	}
	const [center, edge] = imagePoints.map(point => imageToPatient(module, point));
	const radius = circleRadius(center, edge);
	if (!(radius >= MIN_RADIUS)) {
		throw refusal(REFUSAL.DEGENERATE, `Circle radius is below ${MIN_RADIUS} mm`);
	}
	const domain = (source && source.valueType === 'SCOORD3D') ? 'patient' : (tool.coordinateDomain || meta.coordinateDomain);
	if (domain === 'patient' && module.frameOfReferenceUID) {
		return patientCircleArguments(tool, center, edge, imagePlaneNormal(module), module.frameOfReferenceUID);
	}
	return circleArguments(tool, { points: imagePoints, values: circleValues(radius), use3DSpatialCoordinates: false });
}

function circleMeasurementData(MeasurementGroup) {
	// cornerstone-tools state of an image-domain circle group (start the center, end the edge point)
	const { defaultState, SCOORDGroup } = LibraryLegacyMeasurementReport.getSetupMeasurementData(MeasurementGroup);
	const [center, edge] = _.chunk(Array.from(SCOORDGroup.GraphicData, Number), 2);
	return {
		...defaultState,
		toolType: CIRCLE_TOOL_NAMES.CLASSIC,
		handles: {
			start: { x: center[0], y: center[1], highlight: true, active: false },
			end: { x: edge[0], y: edge[1], highlight: true, active: false },
			textBox: { hasMoved: false, movesIndependently: false, drawnIndependently: true, allowedOutsideImage: true, hasBoundingBox: true },
		},
	};
}

function circleAdapter(toolType) {
	// The circle's writer under a tool name: the classic tool, and the Cornerstone3D name the
	// out-of-plane records (utils/outOfPlane.js) hold
	const adapter = class {
		static getMeasurementData(MeasurementGroup) {
			return circleMeasurementData(MeasurementGroup);
		}

		static getTID300RepresentationArguments(tool, context) {
			return circleToolArguments(tool, context);
		}
	};
	adapter.toolType = toolType;
	adapter.utilityToolType = toolType;
	adapter.TID300Representation = TID300CircleMeasurement;
	adapter.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => isAngleTrackingIdentifier(CIRCLE_TRACKING_TOOL, TrackingIdentifier);
	return adapter;
}

const CircleRoi = circleAdapter(CIRCLE_TOOL_NAMES.CLASSIC);
const CircleROI = circleAdapter(CIRCLE_TOOL_NAMES.CORNERSTONE_3D);

CornerstoneLegacyMeasurementReport.registerTool(CircleRoi);
CornerstoneLegacyMeasurementReport.registerTool(CircleROI);


// Adapter Module

const sonadorAdaptersSR = _.extend(c3dAdaptersSR.Cornerstone, {
	DICOMSRSeriesTagTool,
	Angle,
	CircleRoi,
	CobbAngle,
	Length,
});


export default sonadorAdaptersSR;
export {
	sonadorAdaptersSR, angleToolArguments, circleToolArguments, lengthToolArguments, Angle, CircleRoi, CobbAngle, Length, REFUSAL,
}