// A report can be read before the display set of the series it measures lists its instances (a
// study reload), or with none: its measurements are mapped without a display set rather than
// throwing, which used to stop the rest of the report from loading.

jest.mock('@ohif/core', () => ({
  __esModule: true,
  utils: { guid: () => 'guid', roundNumber: value => value },
  default: { log: {}, utils: {}, DICOMSR: { SREnums: { TOOL_NAMES: { DICOM_SR_SERIES_TAG: 'DICOMSRSeriesTagTool' } } } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools/annotation', () => ({ config: { style: { getStyleProperty: () => 'rgb(0, 0, 0)' } } }), { virtual: true });
jest.mock('./utils/getIsLocked', () => ({ getIsLocked: () => false }));
jest.mock('./utils/getIsVisible', () => ({ getIsVisible: () => true }));
jest.mock('./utils/getSOPInstanceAttributes', () => ({
  __esModule: true,
  default: () => ({ SOPInstanceUID: '2.25.10', SeriesInstanceUID: '2.25.2', StudyInstanceUID: '2.25.1' }),
}));
jest.mock('./utils', () => ({ getDisplayUnit: unit => unit }));

import displaySetOf, { NO_DISPLAY_SET } from './utils/displaySetOf';
import Length from './Length';
import Angle from './Angle';
import CobbAngle from './CobbAngle';
import ArrowAnnotate from './ArrowAnnotate';
import CircleROI from './CircleROI';
import DICOMSRSeriesTagTool from './DICOMSRSeriesTagTool';

const serviceOf = (byInstance, bySeries) => ({
  getDisplaySetForSOPInstanceUID: jest.fn(() => byInstance),
  getDisplaySetsForSeries: jest.fn(() => bySeries),
});

describe('displaySetOf', () => {
  it("is the image's display set, else the series' first, else an empty one", () => {
    const image = { displaySetInstanceUID: 'ds-image' };
    const series = { displaySetInstanceUID: 'ds-series' };
    expect(displaySetOf(serviceOf(image, [series]), '2.25.10', '2.25.2')).toBe(image);
    expect(displaySetOf(serviceOf(undefined, [series]), '2.25.10', '2.25.2')).toBe(series);
    expect(displaySetOf(serviceOf(undefined, []), '2.25.10', '2.25.2')).toBe(NO_DISPLAY_SET);
    expect(displaySetOf(serviceOf(undefined, undefined), undefined, undefined)).toBe(NO_DISPLAY_SET);
    expect(NO_DISPLAY_SET.displaySetInstanceUID).toBeUndefined();
  });
});

const hydrated = (toolName, points, stats, data = {}) => ({
  annotation: {
    annotationUID: `${toolName}-1`,
    metadata: { toolName, referencedImageId: 'wadors:4', FrameOfReferenceUID: '2.25.7001' },
    data: { handles: { points, textBox: {} }, text: 'Arrow', label: '', cachedStats: { 'imageId:wadors:4': stats }, ...data },
  },
});

[
  ['Length', Length, [[0, 0, 0], [3, 4, 0]], { length: 5, unit: 'mm' }],
  ['Angle', Angle, [[10, 0, 0], [0, 0, 0], [0, 10, 0]], { angle: 90 }],
  ['CobbAngle', CobbAngle, [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]], { angle: 135 }],
  ['ArrowAnnotate', ArrowAnnotate, [[0, 0, 0], [3, 4, 0]], {}],
  ['CircleROI', CircleROI, [[0, 0, 0], [3, 4, 0]], { radius: 5, area: 78.5, perimeter: 31.4 }],
  ['DICOMSRSeriesTagTool', DICOMSRSeriesTagTool, [[0, 0, 0]], {}, { value: 'img-qc.reject' }],
].forEach(([toolName, mapping, points, stats, data]) => {
  it(`${toolName}: maps a report measurement whose series has no display set yet`, () => {
    const measurement = mapping.toMeasurement(hydrated(toolName, points, stats, data), serviceOf(undefined, []), {}, () => 'value',
      { getCustomization: () => undefined });
    expect(measurement).toMatchObject({ uid: `${toolName}-1`, referenceSeriesUID: '2.25.2' });
    expect(measurement.displaySetInstanceUID).toBeUndefined();
  });
});
