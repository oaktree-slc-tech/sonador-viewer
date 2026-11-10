// The Measurements panel lists the measurements a save writes under "Pending": tools managed by
// the measurement service, looked up by tool type (the id), whatever their display name.

jest.mock('../../App', () => ({ commandsManager: {} }));
jest.mock('./jumpToRowItem.js', () => () => {});
jest.mock('cornerstone-core', () => ({}), { virtual: true });
// The MPR navigation reads image planes from Cornerstone3D (mprMeasurementNavigation.js)
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('@ohif/ui', () => ({ MeasurementTable: () => null }));
// Measurement-service records by cornerstone id
const mockServiceMeasurements = {};

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
    },
    _getToolType: measurement => measurement.toolType,
    seriesInstanceUIDOf: measurement => measurement.SeriesInstanceUID || measurement.referenceSeriesUID,
    studyInstanceUIDOf: measurement => measurement.StudyInstanceUID || measurement.referenceStudyUID,
    trackingIdentifierOf: measurement => measurement.TrackingIdentifier,
    _unpackMeasurementData: measurement => ({
      _id: measurement._id, uid: measurement.uid, measurementMeta: measurement.metadata || {}, measurementData: measurement,
    }),
    _unpackMeasurementLifecycleAttrs: measurement => ({ isLocked: measurement.isLocked, isReadOnly: measurement.isReadOnly }),
  };
  return {
    __esModule: true,
    default: { redux: { actions: {} }, measurements: { MeasurementApi }, display: { DisplaySetApi: {} } },
    DICOMSR: { isToolSupported: () => true, Enums: { TOOL_NAMES: {} }, SREnums: { TOOL_NAMES: { DICOM_SR_SERIES_TAG: 'DICOMSRSeriesTagTool' } } },
    DicomMetadataStore: {},
    displayAttributes: {},
  };
});

const { convertMeasurementsToTableData } = require('./ConnectedMeasurementTable');

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
