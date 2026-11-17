// The panel rows of out-of-plane measurements, and navigation to them: listed pending until saved
// and with the saved measurements once locked; the view in place of the image; in the MPR view the
// pane nearest its plane turns onto it at any angle and the panes move to its centroid; points in
// no common plane are centred on without turning a pane; from the classic viewport the MPR of its
// source series opens at it, except an arrow (a point every slice shows), which goes to the classic
// slice of its series nearest its tip; no navigation without a loaded series of its Frame of Reference.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });

const mockRecords = new Map();
const mockStudies = [];
// The active display sets; none means the display set service is not available
const mockDisplaySets = { active: undefined };
jest.mock('@ohif/core', () => {
  const outOfPlane = jest.requireActual('../../../../core/src/DICOMSR/utils/outOfPlane');
  const drawingPlane = jest.requireActual('../../../../core/src/DICOMSR/utils/drawingPlane');
  const MeasurementApi = {
    Instance: { measurementService: { getMeasurements: () => [...mockRecords.values()], getMeasurement: uid => mockRecords.get(uid) } },
    _unpackMeasurementLifecycleAttrs: m => ({ isLocked: m.isLocked, isReadOnly: m.metadata.isReadOnly, isVisible: m.isVisible }),
    customLineTextColor: () => null,
    trackingIdentifierOf: m => m.metadata.TrackingIdentifier,
  };
  const DicomMetadataStore = {
    getStudyInstanceUIDs: () => mockStudies.map(study => study.StudyInstanceUID),
    getStudy: uid => mockStudies.find(study => study.StudyInstanceUID === uid),
    getSeries: (study, series) => {
      const found = mockStudies.find(candidate => candidate.StudyInstanceUID === study);
      return found && found.series.find(candidate => candidate.SeriesInstanceUID === series);
    },
  };
  return {
    __esModule: true,
    DicomMetadataStore,
    default: {
      measurements: { MeasurementApi },
      // A measurement read from an application document: its tracking UID
      DICOMSR: { outOfPlane, drawingPlane, isApplicationMeasurement: uid => uid === '2.25.555' },
      DicomMetadataStore,
      display: {
        DisplaySetApi: {
          get Instance() {
            return mockDisplaySets.active ? { displaySetService: { activeDisplaySets: mockDisplaySets.active } } : undefined;
          },
        },
      },
    },
  };
});

import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';
import { navigateArrowInStack, navigateToOutOfPlane, openOutOfPlaneInMpr, outOfPlaneRows } from './outOfPlaneRows';

const LENGTH_TOOL = { id: 'Length', toolGroup: 'allTools', options: { measurementTable: { displayFunction: m => `${m.length.toFixed(2)} mm` } } };
const COBB_TOOL = { id: 'CobbAngle', toolGroup: 'allTools', options: { measurementTable: { displayFunction: m => `${m.data.rAngle.toFixed(2)}°` } } };
const CIRCLE_TOOL = { id: 'CircleRoi', toolGroup: 'allTools', options: { measurementTable: { displayFunction: m => `${m.data.cachedStats.radius.toFixed(2)} mm` } } };
// The Bidirectional's own configuration (Target, `L x W mm`)
const { bidirectional: BIDIRECTIONAL_TOOL } = jest.requireActual('../../../../core/src/measurements/tools/bidirectional');
const { arrowAnnotate: ARROW_TOOL } = jest.requireActual('../../../../core/src/measurements/tools/arrowAnnotate');
const TOOLS = [LENGTH_TOOL, COBB_TOOL, CIRCLE_TOOL, BIDIRECTIONAL_TOOL, ARROW_TOOL];
// A sagittal Bidirectional (x = 12): long axis along y, short axis along z, crossing at (12, 10, 0)
const BIDIRECTIONAL_POINTS = [[12, 0, 0], [12, 20, 0], [12, 10, -6], [12, 10, 6]];
// The MPR view of series 2.25.2 (Frame of Reference 2.25.7001)
const MPR = {
  activeViewportIndex: 0, layout: { viewports: [{ vtk: true }] },
  viewportSpecificData: { 0: { StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.2' } },
};
const CLASSIC = { activeViewportIndex: 0, layout: { viewports: [{}] } };
const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const MR_IMAGE = '1.2.840.10008.5.1.4.1.1.4';
const MR_SPECTROSCOPY = '1.2.840.10008.5.1.4.1.1.4.2';

const record = (uid, extra = {}) => ({
  uid, toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]], length: 50, FrameOfReferenceUID: '2.25.7001',
  referenceStudyUID: '2.25.1', referenceSeriesUID: '2.25.2', isLocked: false, isVisible: true,
  ...extra,
  metadata: { outOfPlane: true, sourceSeries: '2.25.2', drawingPlane: '0,1,0,0,0,-1', views: ['sagittal'], ...(extra.metadata || {}) },
});

beforeEach(() => {
  mockDisplaySets.active = undefined;
  mockRecords.clear();
  mockStudies.length = 0;
  mockStudies.push({
    StudyInstanceUID: '2.25.1',
    series: [
      { SeriesInstanceUID: '2.25.2', instances: [{ SOPInstanceUID: '2.25.2.1', SOPClassUID: CT_IMAGE, FrameOfReferenceUID: '2.25.7001' }] },
      // A series of another Frame of Reference, and a second series of the measurement's
      { SeriesInstanceUID: '2.25.3', instances: [{ SOPInstanceUID: '2.25.3.1', SOPClassUID: CT_IMAGE, FrameOfReferenceUID: '2.25.8888' }] },
      { SeriesInstanceUID: '2.25.4', instances: [{ SOPInstanceUID: '2.25.4.1', SOPClassUID: MR_IMAGE, FrameOfReferenceUID: '2.25.7001' }] },
      // Spectroscopy of the measurement's frame: no image to show
      { SeriesInstanceUID: '2.25.5', instances: [{ SOPInstanceUID: '2.25.5.1', SOPClassUID: MR_SPECTROSCOPY, FrameOfReferenceUID: '2.25.7001' }] },
    ],
  });
});


describe('the rows', () => {
  const rowsOf = viewports => outOfPlaneRows(TOOLS, { labelOf: m => m.description || '...', viewports });

  it('lists a pending one with the pending measurements and a saved one, locked, with the saved', () => {
    mockRecords.set('pending', record('pending', { description: 'Femoral neck' }));
    mockRecords.set('saved', record('saved', { isLocked: true, metadata: { isReadOnly: true } }));
    // Locked by the user: still pending, shown locked
    mockRecords.set('locked', record('locked', { isLocked: true }));
    const { pending, saved } = rowsOf(MPR);

    expect(pending.map(({ row, toolGroup }) => [row.measurementId, toolGroup])).toEqual([['pending', 'allTools'], ['locked', 'allTools']]);
    expect(pending[1].row).toMatchObject({ isLocked: true, isReadOnly: false, isPending: true });
    expect(saved[0].row.isPending).toBe(false);
    expect(saved.map(({ row }) => [row.measurementId, row.isLocked])).toEqual([['saved', true]]);
    expect(pending[0].row).toMatchObject({
      toolType: 'Length', _measurementServiceId: 'pending', label: 'Femoral neck', isLocked: false,
      data: [{ displayText: '50.00 mm' }], refStudyInstanceUID: '2.25.1', refSeriesInstanceUID: '2.25.2',
      outOfPlane: { view: 'Sagittal', viewName: 'sagittal', frameOfReferenceLoaded: true, inClassicViewport: false, planar: true },
    });
  });

  it('lists a circle (its Cornerstone3D record) with its radius, and the record as the source of its detail', () => {
    mockRecords.set('circle', record('circle', {
      toolName: 'CircleROI', points: [[12, 0, 0], [12, 3, -4]], length: undefined, unit: 'mm',
      data: { cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI } },
    }));
    const [{ row, toolGroup }] = rowsOf(MPR).pending;

    expect(toolGroup).toBe('allTools');
    expect(row.data).toEqual([{ displayText: '5.00 mm' }]);
    // Its detail (the card, the reference line's +N) is built from the record, in patient coordinates
    expect(row.detailSource).toEqual({ measurement: mockRecords.get('circle'), context: { calibrated: true } });
  });

  it('lists a Bidirectional (its record) as L x W mm, planar, with the record as the source of its detail', () => {
    mockRecords.set('bidirectional', record('bidirectional', {
      toolName: 'Bidirectional', points: BIDIRECTIONAL_POINTS, length: undefined, unit: 'mm',
      data: { longestDiameter: 20, shortestDiameter: 12 },
    }));
    const [{ row, toolGroup }] = rowsOf(MPR).pending;
    expect(toolGroup).toBe('allTools');
    expect(row.toolType).toBe('Bidirectional');
    expect(row.data).toEqual([{ displayText: '20.00 x 12.00 mm' }]);
    expect(row.outOfPlane.planar).toBe(true);
    expect(row.detailSource).toEqual({ measurement: mockRecords.get('bidirectional'), context: { calibrated: true } });
  });

  it('marks a measurement whose points lie in no common plane as not planar, and a Length without a Drawing-Plane as planar', () => {
    mockRecords.set('skew', record('skew', {
      toolName: 'CobbAngle', points: [[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]], data: { rAngle: 90 },
      metadata: { drawingPlane: undefined, views: [] },
    }));
    mockRecords.set('length', record('length', { metadata: { drawingPlane: undefined } }));
    expect(rowsOf(MPR).pending.map(({ row }) => [row.measurementId, row.outOfPlane.planar])).toEqual([['skew', false], ['length', true]]);
  });

  it('marks the rows in the classic viewport, and those of a Frame of Reference no loaded series shares', () => {
    mockRecords.set('a', record('a'));
    mockRecords.set('b', record('b', { FrameOfReferenceUID: '2.25.9999', metadata: { FrameOfReferenceUID: '2.25.9999' } }));
    const { pending } = rowsOf(CLASSIC);
    expect(pending.map(({ row }) => row.outOfPlane)).toEqual([
      expect.objectContaining({ inClassicViewport: true, frameOfReferenceLoaded: true }),
      expect.objectContaining({ inClassicViewport: true, frameOfReferenceLoaded: false }),
    ]);
  });

  it('lists one read from an application document with the saved measurements, marked and never pending', () => {
    mockRecords.set('plan', record('plan', { isLocked: true, metadata: { isReadOnly: true, TrackingUniqueIdentifier: '2.25.555' } }));
    mockRecords.set('report', record('report', { isLocked: true, metadata: { isReadOnly: true, TrackingUniqueIdentifier: '2.25.556' } }));
    const { pending, saved } = rowsOf(CLASSIC);
    expect(pending).toEqual([]);
    expect(saved.map(({ row }) => [row.measurementId, row.fromApplicationDocument, row.isPending])).toEqual([
      ['plan', true, false], ['report', false, false],
    ]);
    // In the classic viewport, the out-of-plane convention: shown in the MPR and 3D views
    expect(saved[0].row.outOfPlane).toMatchObject({ inClassicViewport: true, frameOfReferenceLoaded: true });
  });

  it('places a row while a display set shows a series of its Frame of Reference, its metadata cached or not', () => {
    mockRecords.set('a', record('a'));
    const loaded = () => rowsOf(MPR).pending[0].row.outOfPlane.frameOfReferenceLoaded;
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.2' }, { SeriesInstanceUID: '2.25.3' }];
    expect(loaded()).toBe(true);
    // Its series' display set removed: the series metadata stays cached, and the row is not placed
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.3' }];
    expect(loaded()).toBe(false);
    // Spectroscopy of its frame displayed: no image series to show it on
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.3' }, { SeriesInstanceUID: '2.25.5' }];
    expect(loaded()).toBe(false);
    // An MR image series of its Frame of Reference added
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.3' }, { SeriesInstanceUID: '2.25.4' }];
    expect(loaded()).toBe(true);
  });

  it('opens the MPR of a displayed series of its Frame of Reference only', async () => {
    mockRecords.set('a', record('a'));
    const studyMetadataManager = { get: () => ({ findDisplaySet: match => ['2.25.2', '2.25.4', '2.25.5'].map(SeriesInstanceUID => ({ SeriesInstanceUID })).find(match) }) };
    const open = async () => {
      const commandsManager = { runCommand: jest.fn(() => ({ panes: 3 })) };
      const result = await openOutOfPlaneInMpr({ measurementData: rowsOf(CLASSIC).pending[0].row, commandsManager, studyMetadataManager });
      return [result, commandsManager.runCommand.mock.calls.map(([, { displaySet }]) => displaySet.SeriesInstanceUID)];
    };
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.3' }];
    expect(await open()).toEqual(['unavailable', []]);
    // Spectroscopy of its frame only
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.5' }];
    expect(await open()).toEqual(['unavailable', []]);
    // Its source series not displayed, another series of its Frame of Reference displayed
    mockDisplaySets.active = [{ SeriesInstanceUID: '2.25.4' }];
    expect(await open()).toEqual(['shown', ['2.25.4']]);
  });

  it('lists only out-of-plane records, and not one drawn in the viewports only', () => {
    mockRecords.set('classic', { uid: 'classic', toolName: 'Length', metadata: {} });
    mockRecords.set('unlisted', record('unlisted', { metadata: { isListed: false } }));
    expect(rowsOf(MPR).pending).toEqual([]);
  });
});


describe('navigation', () => {
  const rowOf = (uid, viewports = MPR) => outOfPlaneRows(TOOLS, { labelOf: () => '', viewports })
    .pending.concat(outOfPlaneRows(TOOLS, { labelOf: () => '', viewports }).saved).find(({ row }) => row.measurementId === uid).row;
  const commands = () => ({ runCommand: jest.fn(() => ({ panes: 3, drawn: true })) });
  const close = (actual, expected) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));

  it('in the MPR view, turns the nearest pane onto its Drawing-Plane at any angle and moves to its centroid', () => {
    mockRecords.set('a', record('a'));
    const commandsManager = commands();
    expect(navigateToOutOfPlane({ measurementData: rowOf('a'), viewportsState: MPR, commandsManager })).toBe('shown');
    const [name, { worldPoint, viewPlaneNormal, anyAngle }] = commandsManager.runCommand.mock.calls[0];
    expect(name).toBe('jumpToMprWorldPoint');
    expect(anyAngle).toBe(true);
    close(worldPoint, [12, 15, -20]);
    close(viewPlaneNormal.map(Math.abs), [1, 0, 0]);
  });

  it('centres a circle on its center, turning a pane onto its Drawing-Plane', () => {
    mockRecords.set('circle', record('circle', {
      toolName: 'CircleROI', points: [[12, 0, 0], [12, 3, -4]], data: { cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI } },
    }));
    const commandsManager = commands();
    navigateToOutOfPlane({ measurementData: rowOf('circle'), viewportsState: MPR, commandsManager });
    const [, target] = commandsManager.runCommand.mock.calls[0];
    close(target.worldPoint, [12, 0, 0]);
    close(target.viewPlaneNormal.map(Math.abs), [1, 0, 0]);
  });

  it('centres a Bidirectional on its four points, turning a pane onto its Drawing-Plane', () => {
    mockRecords.set('bidirectional', record('bidirectional', {
      toolName: 'Bidirectional', points: BIDIRECTIONAL_POINTS, data: { longestDiameter: 20, shortestDiameter: 12 },
    }));
    const commandsManager = commands();
    expect(navigateToOutOfPlane({ measurementData: rowOf('bidirectional'), viewportsState: MPR, commandsManager })).toBe('shown');
    const [, target] = commandsManager.runCommand.mock.calls[0];
    close(target.worldPoint, [12, 10, 0]);
    close(target.viewPlaneNormal.map(Math.abs), [1, 0, 0]);
  });

  it.each([['absent', undefined], ['malformed', '1,0,0']])(
    'turns a pane onto the plane of the ELLIPSE a held circle was read from, its Drawing-Plane %s', (name, drawingPlane) => {
      mockRecords.set('held', record('held', {
        toolName: 'CircleROI', points: [[10, 20, 30], [15, 20, 30]], isLocked: true,
        data: { cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI } },
        metadata: {
          isReadOnly: true, drawingPlane, views: ['coronal'],
          sourceGeometry: { valueType: 'SCOORD3D', graphicType: 'ELLIPSE', graphicData: [5, 20, 30, 15, 20, 30, 10, 20, 25, 10, 20, 35] },
        },
      }));
      const commandsManager = commands();
      navigateToOutOfPlane({ measurementData: rowOf('held'), viewportsState: MPR, commandsManager });
      const [, target] = commandsManager.runCommand.mock.calls[0];
      close(target.worldPoint, [10, 20, 30]);
      close(target.viewPlaneNormal.map(Math.abs), [0, 1, 0]);
    });

  it('centres on a circle read from a stock CIRCLE SCOORD3D without turning a pane: its plane is not known', () => {
    mockRecords.set('legacy', record('legacy', {
      toolName: 'CircleROI', points: [[10, 20, 30], [15, 20, 30]], isLocked: true,
      data: { cachedStats: { radius: 5, area: 25 * Math.PI, perimeter: 10 * Math.PI } },
      metadata: { isReadOnly: true, drawingPlane: undefined, sourceGeometry: { valueType: 'SCOORD3D', graphicType: 'CIRCLE', graphicData: [10, 20, 30, 15, 20, 30] } },
    }));
    const commandsManager = commands();
    navigateToOutOfPlane({ measurementData: rowOf('legacy'), viewportsState: MPR, commandsManager });
    const [, target] = commandsManager.runCommand.mock.calls[0];
    close(target.worldPoint, [10, 20, 30]);
    expect(target.viewPlaneNormal).toBeUndefined();
  });

  it('centres on points in no common plane without turning a pane', () => {
    mockRecords.set('skew', record('skew', {
      toolName: 'CobbAngle', points: [[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]], data: { rAngle: 90 }, metadata: { drawingPlane: undefined },
    }));
    const commandsManager = commands();
    navigateToOutOfPlane({ measurementData: rowOf('skew'), viewportsState: MPR, commandsManager });
    const [, target] = commandsManager.runCommand.mock.calls[0];
    expect(target.viewPlaneNormal).toBeUndefined();
    close(target.worldPoint, [2.5, 7.5, 5]);
  });

  it("from the classic viewport, takes an arrow to the slice of its series nearest its tip; other tools and the MPR view keep theirs", () => {
    mockRecords.set('arrow', record('arrow', { toolName: 'ArrowAnnotate', label: 'Lesion margin', points: [[12, 0, 7], [12, 30, 7]],
      metadata: { text: 'Lesion margin' } }));
    mockRecords.set('a', record('a'));
    const commandsManager = { runCommand: jest.fn(() => 'shown') };
    expect(navigateArrowInStack({ measurementData: rowOf('arrow', CLASSIC), viewportsState: CLASSIC, commandsManager })).toBe('shown');
    expect(commandsManager.runCommand).toHaveBeenCalledWith('jumpToNearestSlice', {
      worldPoint: [12, 0, 7], StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.2', activeViewportIndex: 0,
    });

    commandsManager.runCommand.mockClear();
    expect(navigateArrowInStack({ measurementData: rowOf('a', CLASSIC), viewportsState: CLASSIC, commandsManager })).toBe('unavailable');
    expect(navigateArrowInStack({ measurementData: rowOf('arrow'), viewportsState: MPR, commandsManager })).toBe('unavailable');
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
    // The series has no image to go to
    commandsManager.runCommand.mockReturnValue('unavailable');
    expect(navigateArrowInStack({ measurementData: rowOf('arrow', CLASSIC), viewportsState: CLASSIC, commandsManager })).toBe('unavailable');
  });

  it('does not navigate from the classic viewport, nor without a loaded series of its Frame of Reference', () => {
    mockRecords.set('a', record('a'));
    mockRecords.set('b', record('b', { FrameOfReferenceUID: '2.25.9999' }));
    const commandsManager = commands();
    expect(navigateToOutOfPlane({ measurementData: rowOf('a', CLASSIC), viewportsState: CLASSIC, commandsManager })).toBe('unavailable');
    expect(navigateToOutOfPlane({ measurementData: rowOf('b'), viewportsState: MPR, commandsManager })).toBe('unavailable');
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });

  it('opens the MPR of its source series at it from the classic viewport', async () => {
    mockRecords.set('a', record('a'));
    const displaySet = { SeriesInstanceUID: '2.25.2', displaySetInstanceUID: 'ds-2' };
    const studyMetadataManager = { get: uid => (uid === '2.25.1' ? { findDisplaySet: query => [displaySet].find(query) } : undefined) };
    const commandsManager = { runCommand: jest.fn(async () => ({ panes: 3, drawn: true })) };

    useLayoutButton.getState().setIsDisplayedLayoutButton(true);

    await expect(openOutOfPlaneInMpr({ measurementData: rowOf('a', CLASSIC), commandsManager, studyMetadataManager })).resolves.toBe('shown');
    const [name, target] = commandsManager.runCommand.mock.calls[0];
    expect(name).toBe('openMprAtWorldPoint');
    expect(target).toMatchObject({ displaySet, anyAngle: true });
    // The layout button is hidden in the MPR view, as when the 2D MPR button opens it
    expect(useLayoutButton.getState().isDisplayedLayoutButton).toBe(false);
  });

  it('does not navigate when the MPR view shows a series of another Frame of Reference', () => {
    mockRecords.set('a', record('a'));
    const otherFrame = { ...MPR, viewportSpecificData: { 0: { StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.3' } } };
    const commandsManager = commands();
    expect(navigateToOutOfPlane({ measurementData: rowOf('a', otherFrame), viewportsState: otherFrame, commandsManager })).toBe('unavailable');
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });

  it("opens a series of the measurement's Frame of Reference, not a source series of another", async () => {
    // Its Source-Series names a series of another Frame of Reference
    mockRecords.set('a', record('a', { referenceSeriesUID: '2.25.3', metadata: { sourceSeries: '2.25.3' } }));
    const displaySets = ['2.25.2', '2.25.3', '2.25.4'].map(uid => ({ SeriesInstanceUID: uid, displaySetInstanceUID: `ds-${uid}` }));
    const studyMetadataManager = { get: () => ({ findDisplaySet: query => displaySets.find(query) }) };
    const commandsManager = { runCommand: jest.fn(async () => ({ panes: 3, drawn: true })) };

    await openOutOfPlaneInMpr({ measurementData: rowOf('a', CLASSIC), commandsManager, studyMetadataManager });
    expect(commandsManager.runCommand.mock.calls[0][1].displaySet.SeriesInstanceUID).toBe('2.25.2');

    // Its source series, when it shares the Frame of Reference, is preferred
    mockRecords.set('b', record('b', { referenceSeriesUID: '2.25.4', metadata: { sourceSeries: '2.25.4' } }));
    await openOutOfPlaneInMpr({ measurementData: rowOf('b', CLASSIC), commandsManager, studyMetadataManager });
    expect(commandsManager.runCommand.mock.calls[1][1].displaySet.SeriesInstanceUID).toBe('2.25.4');

    // No series of its Frame of Reference: nothing is opened
    mockRecords.set('c', record('c', { FrameOfReferenceUID: '2.25.9999', metadata: { FrameOfReferenceUID: '2.25.9999' } }));
    await expect(openOutOfPlaneInMpr({ measurementData: rowOf('c', CLASSIC), commandsManager, studyMetadataManager }))
      .resolves.toBe('unavailable');
    expect(commandsManager.runCommand).toHaveBeenCalledTimes(2);
  });
});

