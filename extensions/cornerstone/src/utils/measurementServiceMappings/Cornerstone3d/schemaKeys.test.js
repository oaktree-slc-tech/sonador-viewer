// The Cornerstone3D mappings of a hydrated report measurement return only the keys the measurement
// service accepts at the top level of a record (MeasurementService MEASUREMENT_SCHEMA_KEYS): a
// record with any other key is refused, and the measurement is not loaded. The display colours
// read from the report travel in its metadata.

jest.mock('@ohif/core', () => ({ __esModule: true, utils: { guid: () => 'guid', roundNumber: value => value }, default: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools/annotation', () => ({ config: { style: { getStyleProperty: () => 'rgb(0, 0, 0)' } } }), { virtual: true });
jest.mock('./utils/getIsLocked', () => ({ getIsLocked: () => false }));
jest.mock('./utils/getIsVisible', () => ({ getIsVisible: () => true }));
jest.mock('./utils/getSOPInstanceAttributes', () => ({
  __esModule: true,
  default: () => ({ SOPInstanceUID: '2.25.10', SeriesInstanceUID: '2.25.2', StudyInstanceUID: '2.25.1' }),
}));
jest.mock('./utils', () => ({ getDisplayUnit: unit => unit }));

import Length from './Length';
import Angle from './Angle';
import CobbAngle from './CobbAngle';
import ArrowAnnotate from './ArrowAnnotate';

// MeasurementService MEASUREMENT_SCHEMA_KEYS
const SCHEMA_KEYS = [
  'uid', 'color', 'data', 'getReport', 'displayText', 'SOPInstanceUID', 'FrameOfReferenceUID', 'referenceStudyUID',
  'referenceSeriesUID', 'frameNumber', 'displaySetInstanceUID', 'label', 'isLocked', 'isVisible', 'description', 'value',
  'type', 'unit', 'points', 'source', 'toolName', 'metadata', 'area', 'mean', 'stdDev', 'perimeter', 'length',
  'shortestDiameter', 'longestDiameter', 'cachedStats', 'isSelected', 'textBox', 'referencedImageId', 'isDirty',
];

const displaySet = { displaySetInstanceUID: 'ds-1', instances: [{ SOPInstanceUID: '2.25.10', InstanceNumber: 4 }] };
const displaySetService = {
  getDisplaySetForSOPInstanceUID: () => displaySet,
  getDisplaySetsForSeries: () => [displaySet],
};
const COLOURS = { Color: { Border: '#FF8800' } };

const hydrated = (toolName, points, stats) => ({
  annotation: {
    annotationUID: `${toolName}-1`,
    metadata: { toolName, referencedImageId: 'wadors:4', FrameOfReferenceUID: '2.25.7001', TrackingUniqueIdentifier: '2.25.80' },
    data: {
      handles: { points, textBox: {} }, text: 'Arrow', label: '', displayAttributes: COLOURS,
      cachedStats: { 'imageId:wadors:4': stats },
    },
  },
});

[
  ['Length', Length, [[0, 0, 0], [3, 4, 0]], { length: 5, unit: 'mm' }],
  ['Angle', Angle, [[10, 0, 0], [0, 0, 0], [0, 10, 0]], { angle: 90 }],
  ['CobbAngle', CobbAngle, [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]], { angle: 135 }],
  ['ArrowAnnotate', ArrowAnnotate, [[0, 0, 0], [3, 4, 0]], {}],
].forEach(([toolName, mapping, points, stats]) => {
  it(`${toolName}: only schema keys at the top level, the display colours in the metadata`, () => {
    const measurement = mapping.toMeasurement(hydrated(toolName, points, stats), displaySetService, {}, () => 'value', { getCustomization: () => undefined });
    expect(Object.keys(measurement).filter(key => !SCHEMA_KEYS.includes(key))).toEqual([]);
    expect(measurement.metadata.displayAttributes).toEqual(COLOURS);
    expect(measurement.metadata.TrackingUniqueIdentifier).toBe('2.25.80');
  });
});
