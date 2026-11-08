/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The save-parent registry follows the measurement session: a session clear resets it, while
// deleting some measurements (removeMany, a filtered clear) leaves it as it is

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({
  globalImageIdSpecificToolStateManager: { toolState: {}, setImageIdToolState: () => {} },
}), { virtual: true });
jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
jest.mock('../../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/studyMetadataManager', () => ({ __esModule: true, default: {} }));
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, debug: () => {} } }));
jest.mock('../configuration.js', () => ({ measurementApiDefaultConfig: {} }));
jest.mock('../enums', () => ({ __esModule: true, default: { EVENTS: {} } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
const mockClearDisplay = jest.fn();
jest.mock('../../DICOMSR/readOnly/srDisplayAnnotations', () => ({
  clearSRDisplayAnnotations: (...args) => mockClearDisplay(...args),
  setSRDisplayAnnotationVisible: () => {},
}));

import MeasurementApi from './MeasurementApi';
import MeasurementService from '../../services/MeasurementService/MeasurementService';
import { clearHydratedReports, registerHydratedReport, saveParent } from '../../DICOMSR/utils/srDocument';

const STUDY = '2.25.1001';
const OTHER_STUDY = '2.25.2001';

const registerParent = () => registerHydratedReport({
  StudyInstanceUID: STUDY, SeriesInstanceUID: '2.25.11', SOPInstanceUID: '2.25.10',
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.22', ContentTemplateSequence: [{ TemplateIdentifier: '1500', MappingResource: 'DCMR' }],
});

// A MeasurementService wired to the API's cleared handler, holding measurements of two studies
const session = () => {
  const measurementService = new MeasurementService();
  const api = {
    tools: {},
    measurementService,
    measurementsCount: () => ({ service: measurementService.getMeasurements().length }),
    syncMeasurementsAndToolData: () => {},
  };
  measurementService.subscribe(measurementService.EVENTS.MEASUREMENTS_CLEARED,
    MeasurementApi.prototype.onServiceMeasurementCleared.bind(api));
  [['m1', STUDY], ['m2', STUDY], ['m3', OTHER_STUDY]].forEach(([uid, referenceStudyUID]) => {
    measurementService.measurements.set(uid, { uid, referenceStudyUID });
  });
  return api;
};

beforeEach(() => {
  clearHydratedReports();
  registerParent();
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());


describe('MeasurementApi save parents', () => {
  it('a session clear (MeasurementApi.clearMeasurements) resets them, and removes the read-only display', () => {
    const api = session();
    mockClearDisplay.mockClear();
    MeasurementApi.prototype.clearMeasurements.call(api);
    expect(saveParent(STUDY)).toBeNull();
    expect(mockClearDisplay).toHaveBeenCalledTimes(1);
  });

  it('removing some measurements (removeMany) keeps the parent of the ones that remain', () => {
    const { measurementService } = session();
    measurementService.removeMany(['m1']);
    expect(measurementService.getMeasurements().map(m => m.uid)).toEqual(['m2', 'm3']);
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.10', TemplateIdentifier: '1500' });
  });

  it("a filtered clear, of this study's subset or of another study, keeps the parent", () => {
    const { measurementService } = session();
    measurementService.clearMeasurements(m => m.uid === 'm2');
    measurementService.clearMeasurements(m => m.referenceStudyUID === OTHER_STUDY);
    expect(measurementService.getMeasurements().map(m => m.uid)).toEqual(['m1']);
    expect(saveParent(STUDY)).toMatchObject({ SOPInstanceUID: '2.25.10' });
  });
});
