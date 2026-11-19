// The Measurements panel lists the measurements a save writes under "Pending": tools managed by
// the measurement service, looked up by tool type (the id), whatever their display name.

jest.mock('../../App', () => ({ commandsManager: {} }));
jest.mock('./jumpToRowItem.js', () => () => {});
jest.mock('cornerstone-core', () => ({}), { virtual: true });
// The MPR navigation reads image planes from Cornerstone3D (mprMeasurementNavigation.js)
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('@ohif/ui', () => ({ MeasurementTable: () => null }));
// The drawing-plane utilities read the Cornerstone3D SR code scheme
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
// Measurement-service records by cornerstone id, and the out-of-plane records of the service
const mockServiceMeasurements = {};
const mockOutOfPlane = [];

jest.mock('@ohif/core', () => {
  const { angle } = jest.requireActual('../../../../core/src/measurements/tools/angle');
  const { cobbAngle } = jest.requireActual('../../../../core/src/measurements/tools/cobbAngle');
  const { length } = jest.requireActual('../../../../core/src/measurements/tools/length');
  const SERVICE_TOOLS = ['Angle', 'CobbAngle', 'Length'];
  const MeasurementApi = {
    getConfiguration: () => ({
      measurementTools: [{ id: 'allTools', name: 'Measurements', childTools: [angle, cobbAngle, length] }],
    }),
    Instance: {
      _serviceManagedTool: toolType => ({ toolServiceManaged: SERVICE_TOOLS.includes(toolType) }),
      getServiceMeasurementByCornerstoneId: _id => mockServiceMeasurements[_id],
      measurementService: { getMeasurements: () => mockOutOfPlane },
      // The timepoint of a measurement: its own, else Study Date/Time
      timepointIdOf: measurement => measurement.timepointId || (measurement.metadata && measurement.metadata.timepointId) || 'tp-1',
    },
    _getToolType: measurement => measurement.toolType,
    seriesInstanceUIDOf: measurement => measurement.SeriesInstanceUID || measurement.referenceSeriesUID,
    studyInstanceUIDOf: measurement => measurement.StudyInstanceUID || measurement.referenceStudyUID,
    trackingIdentifierOf: measurement => measurement.TrackingIdentifier,
    _unpackMeasurementData: measurement => ({
      _id: measurement._id, uid: measurement.uid, measurementMeta: measurement.metadata || {}, measurementData: measurement,
    }),
    _unpackMeasurementLifecycleAttrs: measurement => ({ isLocked: measurement.isLocked, isReadOnly: measurement.isReadOnly }),
    customLineTextColor: measurement => measurement.mockCustomColor || null,
  };
  return {
    __esModule: true,
    default: {
      redux: { actions: {} }, measurements: { MeasurementApi }, display: { DisplaySetApi: {} },
      DICOMSR: {
        outOfPlane: jest.requireActual('../../../../core/src/DICOMSR/utils/outOfPlane'),
        drawingPlane: jest.requireActual('../../../../core/src/DICOMSR/utils/drawingPlane'),
      },
    },
    DICOMSR: {
      isToolSupported: () => true, Enums: { TOOL_NAMES: {} }, SREnums: { TOOL_NAMES: { DICOM_SR_SERIES_TAG: 'DICOMSRSeriesTagTool' } },
      // Measurements read from an application document
      isApplicationMeasurement: uid => uid === '2.25.555',
    },
    DicomMetadataStore: { getStudyInstanceUIDs: () => [], getStudy: () => undefined },
    displayAttributes: {},
  };
});

const { convertMeasurementsToTableData, timepointSelectorEntries } = require('./ConnectedMeasurementTable');

const timepoints = [{ timepointId: 'tp-1' }];
const drawn = (toolType, extra = {}) => {
  const measurement = {
    _id: `${toolType}-1`, uid: `${toolType}-uid`, toolType, measurementNumber: 1, timepointId: 'tp-1', data: { rAngle: 135 }, ...extra,
  };
  mockServiceMeasurements[measurement._id] = measurement;
  return measurement;
};
const groupsOf = collections => convertMeasurementsToTableData(collections, timepoints)
  .map(group => [group.groupName, group.measurements.map(item => item.toolType)]);

it('lists a drawn Cobb angle under Pending Measurements, as an Angle', () => {
  expect(groupsOf({ CobbAngle: [drawn('CobbAngle')], Angle: [drawn('Angle')] }))
    .toEqual([['Pending Measurements', ['CobbAngle', 'Angle']]]);
});

it('shows its value', () => {
  const [group] = convertMeasurementsToTableData({ CobbAngle: [drawn('CobbAngle')] }, timepoints);
  expect(group.measurements[0].data[0].displayText).toBe('135.00°');
});

it('keeps read-only measurements in Measurements', () => {
  expect(groupsOf({ CobbAngle: [drawn('CobbAngle', { isReadOnly: true })] }))
    .toEqual([['Measurements', ['CobbAngle']]]);
});

it('leaves out a measurement drawn in the viewports only (one of an application document)', () => {
  expect(groupsOf({
    CobbAngle: [drawn('CobbAngle', { isReadOnly: true, isListed: false })],
    Angle: [drawn('Angle', { isReadOnly: true })],
  })).toEqual([['Measurements', ['Angle']]]);
});

it('numbers the rows in the order it lists them, saved then pending, out-of-plane measurements included', () => {
  // Saved: read-only and locked; a pending one the user locked stays pending
  const outOfPlane = (uid, isLocked, isReadOnly = isLocked) => ({
    uid, toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]], length: 50, isLocked, isReadOnly, FrameOfReferenceUID: '2.25.7001',
    metadata: { outOfPlane: true, views: ['sagittal'] },
  });
  mockOutOfPlane.push(outOfPlane('oop-saved', true), outOfPlane('oop-pending', false), outOfPlane('oop-locked', true, false));
  // Classic measurement numbers that are not sequential
  const groups = convertMeasurementsToTableData({
    CobbAngle: [drawn('CobbAngle', { isReadOnly: true, measurementNumber: 4 })],
    Angle: [drawn('Angle', { measurementNumber: 9 }), drawn('Angle', { measurementNumber: 10, isLocked: true, _id: 'Angle-2', uid: 'Angle-uid-2' })],
  }, timepoints);
  mockOutOfPlane.length = 0;

  expect(groups.map(group => [group.groupName, group.measurements.map(row => [row.measurementId, row.itemNumber])])).toEqual([
    ['Measurements', [['CobbAngle-1', 1], ['oop-saved', 2]]],
    ['Pending Measurements', [['Angle-1', 3], ['Angle-2', 4], ['oop-pending', 5], ['oop-locked', 6]]],
  ]);
});


it('gives each measurement its own row, even two that share a measurement number, in the order of their numbers', () => {
  const groups = convertMeasurementsToTableData({
    Length: [
      drawn('Length', { _id: 'Length-3', uid: 'Length-uid-3', measurementNumber: 3, length: 30 }),
      drawn('Length', { _id: 'Length-1', uid: 'Length-uid-1', measurementNumber: 2, length: 10 }),
      drawn('Length', { _id: 'Length-2', uid: 'Length-uid-2', measurementNumber: 2, length: 20 }),
    ],
  }, timepoints);
  const [pending] = groups;
  expect(pending.measurements.map(row => row.measurementId)).toEqual(['Length-1', 'Length-2', 'Length-3']);
  // Each row shows its own measurement's value only
  pending.measurements.forEach(row => expect(row.data).toHaveLength(1));
});

it('marks as pending (the rows with an actions menu) the measurements not yet saved that have a service record', () => {
  const groups = convertMeasurementsToTableData({
    CobbAngle: [drawn('CobbAngle', { isReadOnly: true })],
    Angle: [drawn('Angle'), drawn('Angle', { _id: 'Angle-2', uid: undefined, measurementNumber: 2 })],
  }, timepoints);

  expect(groups.map(group => group.measurements.map(row => [row.measurementId, row.isPending]))).toEqual([
    [['CobbAngle-1', false]],
    [['Angle-1', true], ['Angle-2', false]],
  ]);
});

it("carries a measurement's custom colors to its row, for the indicator", () => {
  const [group] = convertMeasurementsToTableData({
    Angle: [drawn('Angle', { mockCustomColor: { line: '#FF8800', text: null } }), drawn('Angle', { _id: 'Angle-2', measurementNumber: 2 })],
  }, timepoints);
  expect(group.measurements.map(row => row.customColor)).toEqual([{ line: '#FF8800', text: null }, null]);
});


it('marks the row of a measurement read from an application document, read-only and never pending', () => {
  const [group] = convertMeasurementsToTableData({
    Length: [drawn('Length', { isReadOnly: true, isLocked: true, metadata: { TrackingUniqueIdentifier: '2.25.555' } })],
  }, timepoints);
  expect(group.groupName).toBe('Measurements');
  expect(group.measurements[0]).toMatchObject({ fromApplicationDocument: true, isReadOnly: true, isLocked: true, isPending: false });

  const [other] = convertMeasurementsToTableData({
    Length: [drawn('Length', { isReadOnly: true, isLocked: true, metadata: { TrackingUniqueIdentifier: '2.25.556' } })],
  }, timepoints);
  expect(other.measurements[0].fromApplicationDocument).toBe(false);
});


describe('timepoints', () => {
  it('lists the rows of the active timepoint only, each with its timepoint and one data entry', () => {
    const groups = convertMeasurementsToTableData({
      Length: [
        drawn('Length', { _id: 'Length-1', uid: 'Length-uid-1', measurementNumber: 1, timepointId: 'tp-1' }),
        drawn('Length', { _id: 'Length-2', uid: 'Length-uid-2', measurementNumber: 2, timepointId: 'timepoint:s:2.25.7' }),
      ],
    }, timepoints, { activeTimepointId: 'tp-1' });
    expect(groups.map(group => group.measurements.map(row => [row.measurementId, row.timepointId]))).toEqual([[['Length-1', 'tp-1']]]);
    expect(groups[0].measurements[0].data).toHaveLength(1);

    const defined = convertMeasurementsToTableData({
      Length: [
        drawn('Length', { _id: 'Length-1', uid: 'Length-uid-1', measurementNumber: 1, timepointId: 'tp-1' }),
        drawn('Length', { _id: 'Length-2', uid: 'Length-uid-2', measurementNumber: 2, timepointId: 'timepoint:s:2.25.7', isReadOnly: true }),
      ],
    }, timepoints, { activeTimepointId: 'timepoint:s:2.25.7' });
    expect(defined.map(group => [group.groupName, group.measurements.map(row => row.measurementId)])).toEqual([['Measurements', ['Length-2']]]);
  });

  it('lists every row when no active timepoint is given, as before', () => {
    const groups = convertMeasurementsToTableData({
      Length: [
        drawn('Length', { _id: 'Length-1', uid: 'Length-uid-1', measurementNumber: 1, timepointId: 'tp-1' }),
        drawn('Length', { _id: 'Length-2', uid: 'Length-uid-2', measurementNumber: 2, timepointId: 'timepoint:s:2.25.7' }),
      ],
    }, timepoints);
    expect(groups[0].measurements.map(row => row.measurementId)).toEqual(['Length-1', 'Length-2']);
  });

  it('lists an out-of-plane measurement under the active timepoint only', () => {
    const outOfPlane = (uid, timepointId) => ({
      uid, toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]], length: 50, isLocked: false, isReadOnly: false, FrameOfReferenceUID: '2.25.7001',
      metadata: { outOfPlane: true, views: ['sagittal'], timepointId },
    });
    mockOutOfPlane.push(outOfPlane('oop-default', 'tp-1'), outOfPlane('oop-defined', 'timepoint:s:2.25.7'));
    const rows = convertMeasurementsToTableData({}, timepoints, { activeTimepointId: 'tp-1' }).flatMap(group => group.measurements);
    mockOutOfPlane.length = 0;
    expect(rows.map(row => [row.measurementId, row.timepointId])).toEqual([['oop-default', 'tp-1']]);
  });

  it('builds the selector entries: Study Date/Time first with the header date, then each defined timepoint with its label fallbacks', () => {
    const entries = timepointSelectorEntries([
      { timepointId: 'TimepointId', isDefault: true, timepointType: 'baseline', studyInstanceUIDs: ['1.2.3'], measurementCount: 2, landmarkSetCount: 0 },
      { timepointId: 'timepoint:1.2.3:2.25.7', timepointType: 'defined', date: '20261104', time: '093000', description: 'Post-operative review, 6 weeks', id: 'TP-POSTOP-6W', studyInstanceUIDs: ['1.2.3'] },
      { timepointId: 'timepoint:1.2.3:2.25.8', timepointType: 'defined', date: '20260901', time: null, description: null, id: 'TP-PREOP', studyInstanceUIDs: ['1.2.3'] },
      { timepointId: 'timepoint:1.2.3:2.25.9', timepointType: 'defined', date: '20260101', description: null, id: null, studyInstanceUIDs: ['1.2.3'] },
      { timepointId: 'timepoint:1.2.3:2.25.10', timepointType: 'defined', date: '2026-01-01', dateValid: false, description: null, id: null, studyInstanceUIDs: ['1.2.3'] },
    ], { date: 'November 04, 2026' });
    expect(entries.map(entry => [entry.timepointId, entry.isDefault, entry.label, entry.date, entry.time])).toEqual([
      ['TimepointId', true, 'Study Date/Time', 'November 04, 2026', undefined],
      ['timepoint:1.2.3:2.25.7', false, 'Post-operative review, 6 weeks', 'November 04, 2026', '09:30'],
      ['timepoint:1.2.3:2.25.8', false, 'TP-PREOP', 'September 01, 2026', undefined],
      ['timepoint:1.2.3:2.25.9', false, 'Timepoint January 01, 2026', undefined, undefined],
      ['timepoint:1.2.3:2.25.10', false, 'Timepoint', undefined, undefined],
    ]);
    // One study loaded: no study text
    expect(entries.every(entry => entry.study === undefined)).toBe(true);
    expect(entries[0].measurementCount).toBe(2);
  });
});
