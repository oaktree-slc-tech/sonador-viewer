// Measurements panel while the MPR view is open: a measurement of the MPR series is brought into
// view in the MPR panes; one of another series, or one whose image is beyond the panes' alignment
// limit, asks first, then closes the MPR view and navigates in the stack viewport; cancelling
// leaves the MPR view as it is.

const mockPlanes = {
  'wadors:axial-12': {
    imagePositionPatient: [-100, -100, 12], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
    rowPixelSpacing: 0.5, columnPixelSpacing: 0.5, rows: 400, columns: 400,
  },
};
jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: (type, imageId) => (type === 'imagePlaneModule' ? mockPlanes[imageId] : undefined) },
}), { virtual: true });

const mockTools = { Length: [], CobbAngle: [], CircleRoi: [] };
jest.mock('@ohif/core', () => {
  const angleGeometry = jest.requireActual('../../../../core/src/DICOMSR/utils/angleGeometry');
  const MeasurementApi = {
    Instance: { get tools() { return mockTools; }, getServiceMeasurementByCornerstoneId: () => undefined },
    _getToolType: m => m.toolType || m.toolName,
    seriesInstanceUIDOf: m => m.SeriesInstanceUID || m.referenceSeriesUID,
    _getImageIdentifiers: m => ({ imageId: m.referencedImageId || (m.metadata && m.metadata.referencedImageId) }),
  };
  return { __esModule: true, default: { measurements: { MeasurementApi }, DICOMSR: { angleGeometry } } };
});

import navigateToMeasurementInMpr, { DIALOG, isMprActive, obliqueDialog, worldTargetOf } from './mprMeasurementNavigation';

const MPR_SERIES = '2.25.2001';
const viewportsState = {
  activeViewportIndex: 1,
  layout: { viewports: [{ vtk: { mode: 'mpr' } }, { vtk: { mode: 'mpr' } }, { vtk: { mode: 'mpr' } }] },
  viewportSpecificData: { 1: { SeriesInstanceUID: MPR_SERIES } },
};
const cobbAngle = (series = MPR_SERIES) => ({
  _id: 'cobb-1', toolType: 'CobbAngle', SeriesInstanceUID: series, referencedImageId: 'wadors:axial-12',
  handles: {
    start: { x: 100, y: 100 }, end: { x: 140, y: 100 }, start2: { x: 100, y: 140 }, end2: { x: 140, y: 180 }, textBox: { x: 900, y: 900 },
  },
});
const row = measurement => ({ measurementId: measurement._id, toolType: measurement.toolType });

let commandsManager;
let confirm;
let navigateOutsideMpr;
beforeEach(() => {
  jest.useFakeTimers();
  // As the vtk command reports a pane parallel to the measurement
  commandsManager = { runCommand: jest.fn(name => (name === 'jumpToMprWorldPoint' ? { panes: 3, drawn: true, limitDegrees: 15 } : undefined)) };
  confirm = jest.fn();
  navigateOutsideMpr = jest.fn();
  mockTools.CobbAngle = [];
  mockTools.Length = [];
});
afterEach(() => jest.useRealTimers());

const navigate = measurement => navigateToMeasurementInMpr({
  measurementData: row(measurement), viewportsState, commandsManager, confirm, navigateOutsideMpr,
});

it('recognises the MPR view from the active viewport', () => {
  expect(isMprActive(viewportsState)).toBe(true);
  expect(isMprActive({ activeViewportIndex: 0, layout: { viewports: [{ plugin: 'cornerstone' }] } })).toBe(false);
});

it('shows a measurement of the MPR series in the MPR panes, at the centre of its handles', async () => {
  const measurement = cobbAngle();
  mockTools.CobbAngle = [measurement];
  await expect(navigate(measurement)).resolves.toBe('shown');

  // Image centre of the handles (120, 130); pixel centre at 0.5, 0.5 mm spacing from (-100, -100, 12)
  expect(commandsManager.runCommand).toHaveBeenCalledTimes(1);
  const [command, { worldPoint }] = commandsManager.runCommand.mock.calls[0];
  expect(command).toBe('jumpToMprWorldPoint');
  expect(worldPoint[0]).toBeCloseTo(-100 + 0.5 * (120 - 0.5), 6);
  expect(worldPoint[1]).toBeCloseTo(-100 + 0.5 * (130 - 0.5), 6);
  expect(worldPoint[2]).toBeCloseTo(12, 6);
  // The plane of its image, for the pane that turns onto it
  expect(commandsManager.runCommand.mock.calls[0][1].viewPlaneNormal).toEqual([0, 0, 1]);
  expect(confirm).not.toHaveBeenCalled();
});

it('asks before leaving the MPR view for a measurement of another series, then closes it and navigates', async () => {
  const measurement = cobbAngle('2.25.3001');
  mockTools.CobbAngle = [measurement];
  confirm.mockResolvedValue(true);

  const done = navigate(measurement);
  await Promise.resolve();
  await Promise.resolve();
  jest.runAllTimers();
  await expect(done).resolves.toBe('left');

  expect(confirm).toHaveBeenCalledWith(DIALOG);
  expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  expect(commandsManager.runCommand).not.toHaveBeenCalledWith('jumpToMprWorldPoint', expect.anything());
  expect(navigateOutsideMpr).toHaveBeenCalledTimes(1);
});

it('asks before leaving the MPR view for a measurement of the MPR series that no pane can draw', async () => {
  const measurement = cobbAngle();
  mockTools.CobbAngle = [measurement];
  commandsManager.runCommand.mockImplementation(name =>
    (name === 'jumpToMprWorldPoint' ? { panes: 3, drawn: false, limitDegrees: 15 } : undefined));
  confirm.mockResolvedValue(true);

  const done = navigate(measurement);
  await Promise.resolve();
  await Promise.resolve();
  jest.runAllTimers();
  await expect(done).resolves.toBe('left');

  expect(confirm).toHaveBeenCalledWith(obliqueDialog(15));
  expect(obliqueDialog(15)).toMatchObject({ title: 'Close MPR View?', confirmText: 'Show Measurement', cancelText: 'Cancel' });
  expect(obliqueDialog(15).message).toBe("This measurement's image is tilted more than 15° from the MPR views, so it "
    + 'cannot be drawn in them. To show it, the MPR view closes and the viewer opens the series at the measurement.');
  expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  expect(navigateOutsideMpr).toHaveBeenCalledTimes(1);
});

it('stays in the MPR view, not reporting it shown, when the user cancels for a measurement no pane can draw', async () => {
  const measurement = cobbAngle();
  mockTools.CobbAngle = [measurement];
  commandsManager.runCommand.mockImplementation(name =>
    (name === 'jumpToMprWorldPoint' ? { panes: 3, drawn: false, limitDegrees: 15 } : undefined));
  confirm.mockResolvedValue(false);

  await expect(navigate(measurement)).resolves.toBe('cancelled');
  expect(commandsManager.runCommand).not.toHaveBeenCalledWith('setCornerstoneLayout');
  expect(navigateOutsideMpr).not.toHaveBeenCalled();
});

it('is unavailable without MPR panes to move', async () => {
  const measurement = cobbAngle();
  mockTools.CobbAngle = [measurement];
  commandsManager.runCommand.mockImplementation(() => undefined);
  await expect(navigate(measurement)).resolves.toBe('unavailable');
  expect(confirm).not.toHaveBeenCalled();
});

it('stays in the MPR view when the user cancels', async () => {
  const measurement = cobbAngle('2.25.3001');
  mockTools.CobbAngle = [measurement];
  confirm.mockResolvedValue(false);

  await expect(navigate(measurement)).resolves.toBe('cancelled');
  expect(commandsManager.runCommand).not.toHaveBeenCalled();
  expect(navigateOutsideMpr).not.toHaveBeenCalled();
});

it("asks in the viewer's voice: a question title, the consequence, a verb on the primary button", () => {
  expect(DIALOG).toMatchObject({ title: 'Close MPR View?', confirmText: 'Show Measurement', cancelText: 'Cancel' });
  expect(DIALOG.message).toBe('This measurement is on another series. To show it, the MPR view closes and the viewer '
    + 'opens that series at the measurement.');
});

it('targets the center of a circle, not the middle of its center and edge', () => {
  const target = worldTargetOf({
    toolType: 'CircleRoi', referencedImageId: 'wadors:axial-12',
    handles: { start: { x: 100.5, y: 120.5 }, end: { x: 140.5, y: 120.5 }, textBox: { x: 900, y: 900 } },
  });
  expect(target[0]).toBeCloseTo(-100 + 0.5 * 100, 6);
  expect(target[1]).toBeCloseTo(-100 + 0.5 * 120, 6);
  expect(target[2]).toBeCloseTo(12, 6);
});

it('targets the image centre for a measurement without handles, and nothing without an image plane', () => {
  const target = worldTargetOf({ referencedImageId: 'wadors:axial-12' });
  expect(target[0]).toBeCloseTo(-100 + 0.5 * (200 - 0.5), 6);
  expect(target[2]).toBeCloseTo(12, 6);
  expect(worldTargetOf({ referencedImageId: 'wadors:unknown' })).toBeUndefined();
});


it('imports Cornerstone3D statically: webpack cannot resolve a CommonJS require of its ESM-only package', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'mprMeasurementNavigation.js'), 'utf8');
  expect(source).not.toMatch(/require\(\s*['"]@cornerstonejs\//);
});


it('gives the plane of an oblique image as the plane to turn onto', () => {
  mockPlanes['wadors:sagittal-oblique'] = {
    imagePositionPatient: [0, 0, 0], rowCosines: [0.0576, 0.9983, 0], columnCosines: [0, 0, -1],
    rowPixelSpacing: 1, columnPixelSpacing: 1, rows: 10, columns: 10,
  };
  const { planeNormalOf } = require('./mprMeasurementNavigation');
  const normal = planeNormalOf({ referencedImageId: 'wadors:sagittal-oblique' });
  expect(normal[0]).toBeCloseTo(-0.9983, 4);
  expect(normal[1]).toBeCloseTo(0.0576, 4);
  expect(planeNormalOf({ referencedImageId: 'wadors:unknown' })).toBeUndefined();
});
