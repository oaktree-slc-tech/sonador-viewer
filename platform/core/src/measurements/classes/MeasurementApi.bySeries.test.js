/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Measurements by series, shared through the measurement API: one resolver finds a measurement's
// series wherever its schema keeps it, and getMeasurementsBySeries lists every measurement the
// API holds (the service's records for the representations it manages, and the read-only
// representations only the API holds) under its series, with the tool it was drawn with and
// whether it is pending, read-only or locked.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, setImageIdToolState: () => {} },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({
  __esModule: true,
  default: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) } },
}));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: () => {},
  setSRDisplayAnnotationVisible: () => {},
}));


import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';

describe('seriesInstanceUIDOf and the other resolvers', () => {
  it("finds the series and study wherever a measurement's schema keeps them", () => {
    expect(MeasurementApi.seriesInstanceUIDOf({ referenceSeriesUID: 's1' })).toBe('s1');
    expect(MeasurementApi.seriesInstanceUIDOf({ SeriesInstanceUID: 's2' })).toBe('s2');
    expect(MeasurementApi.seriesInstanceUIDOf({ metadata: { SeriesInstanceUID: 's3' } })).toBe('s3');
    expect(MeasurementApi.seriesInstanceUIDOf({ measurementData: { referenceSeriesUID: 's4' } })).toBe('s4');
    expect(MeasurementApi.seriesInstanceUIDOf({})).toBeUndefined();
    expect(MeasurementApi.seriesInstanceUIDOf(undefined)).toBeUndefined();
    expect(MeasurementApi.studyInstanceUIDOf({ referenceStudyUID: 't1' })).toBe('t1');
    expect(MeasurementApi.studyInstanceUIDOf({ metadata: { StudyInstanceUID: 't2' } })).toBe('t2');
  });

  it('names the tool a measurement was drawn with, from a report its tracking identifier', () => {
    expect(MeasurementApi.measurementToolType({ toolType: 'DICOMSRDisplayTool', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Length' })).toBe('Length');
    expect(MeasurementApi.measurementToolType({ metadata: { toolName: 'CobbAngle' } })).toBe('CobbAngle');
    expect(MeasurementApi.trackingIdentifierOf({ metadata: { TrackingIdentifier: 'x:Angle' } })).toBe('x:Angle');
  });
});

describe('getMeasurementsBySeries', () => {
  const SERVICE_TOOLS = ['Length', 'CobbAngle'];
  const apiWith = (records, tools) => {
    const measurementService = new MeasurementService();
    records.forEach(record => measurementService.measurements.set(record.uid, record));
    return {
      measurementService,
      tools,
      _serviceManagedTool: toolType => ({ toolServiceManaged: SERVICE_TOOLS.includes(toolType) }),
    };
  };
  const bySeries = api => MeasurementApi.prototype.getMeasurementsBySeries.call(api);

  const api = apiWith(
    [
      { uid: 'u1', toolName: 'Length', referenceSeriesUID: 's1', referenceStudyUID: 't1', metadata: { _id: 'len-1' } },
      { uid: 'u2', toolName: 'CobbAngle', referenceSeriesUID: 's1', isLocked: true, metadata: { _id: 'cobb-1', isReadOnly: true } },
    ],
    {
      Length: [{ _id: 'len-1', toolType: 'Length' }],
      CobbAngle: [{ _id: 'cobb-1', toolType: 'CobbAngle' }],
      DICOMSRDisplayTool: [
        { _id: 'ro-1', toolType: 'DICOMSRDisplayTool', isReadOnly: true, SeriesInstanceUID: 's2', TrackingIdentifier: 'cornerstoneTools@^4.0.0:Length' },
        { _id: 'ro-2', toolType: 'DICOMSRDisplayTool', isReadOnly: true },
      ],
    }
  );

  it('lists every measurement under its series, the record for a service-managed one', () => {
    const map = bySeries(api);
    expect([...map.keys()]).toEqual(['s1', 's2', null]);
    const [length, cobb] = map.get('s1');
    expect(length).toMatchObject({
      measurement: { uid: 'u1' }, representation: { _id: 'len-1' }, seriesInstanceUID: 's1', studyInstanceUID: 't1',
      toolType: 'Length', serviceManaged: true, readOnly: false, locked: false, pending: true,
    });
    expect(cobb).toMatchObject({ toolType: 'CobbAngle', readOnly: true, locked: true, pending: false });
  });

  it("lists a report's read-only measurements under their series by the tool they were drawn with", () => {
    const [reported] = bySeries(api).get('s2');
    expect(reported).toMatchObject({
      measurement: { _id: 'ro-1' }, toolType: 'Length', trackingIdentifier: 'cornerstoneTools@^4.0.0:Length',
      serviceManaged: false, readOnly: true, pending: false,
    });
    expect(bySeries(api).get(null).map(entry => entry.representation._id)).toEqual(['ro-2']);
  });

  it('gives one series, or the measurements without a series', () => {
    const forSeries = uid => MeasurementApi.prototype.getMeasurementsForSeries.call({
      getMeasurementsBySeries: () => bySeries(api),
    }, uid);
    expect(forSeries('s1').map(entry => entry.toolType)).toEqual(['Length', 'CobbAngle']);
    expect(forSeries(undefined).map(entry => entry.representation._id)).toEqual(['ro-2']);
    expect(forSeries('nope')).toEqual([]);
  });
});
