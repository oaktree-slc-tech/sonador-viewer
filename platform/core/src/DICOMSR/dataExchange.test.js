// After a report is stored, the memoised metadata of the study it belongs to is dropped, so the
// next load of the study lists the new report series. The study is the report's own: a series tag
// measurement carries no StudyInstanceUID of its own.

const mockStow = jest.fn();
const mockDeletePromise = jest.fn();
jest.mock('./handleStructuredReport', () => ({
  retrieveMeasurementFromSR: jest.fn(),
  stowSRFromMeasurements: (...args) => mockStow(...args),
}));
jest.mock('../studies', () => ({ __esModule: true, default: { deleteStudyMetadataPromise: (...a) => mockDeletePromise(...a) } }));
jest.mock('../utils', () => ({ __esModule: true, default: {} }));
jest.mock('../display', () => ({ __esModule: true, default: {} }));
jest.mock('../log', () => ({ __esModule: true, default: { info: () => {}, error: () => {} } }));
jest.mock('./Cornerstone3d/utils/findMostRecentStructuredReport', () => ({ __esModule: true, default: () => undefined }));
jest.mock('./Cornerstone3d/utils/findStructuredReports', () => ({ __esModule: true, default: () => [] }));

import { storeMeasurements } from './dataExchange';

const SERVER = { type: 'dicomWeb', wadoRoot: 'https://dicomweb' };

beforeEach(() => {
  mockStow.mockReset();
  mockDeletePromise.mockReset();
});

it("drops the stored report's study metadata when the measurements name no study", async () => {
  mockStow.mockResolvedValue({ StudyInstanceUID: '2.25.300' });
  await storeMeasurements({ DICOMSRSeriesTagTool: [{ description: 'tag' }] }, {}, SERVER, {});
  expect(mockDeletePromise).toHaveBeenCalledWith('2.25.300');
});

it('falls back to the first measurement when the save names no study', async () => {
  mockStow.mockResolvedValue(undefined);
  await storeMeasurements({ Length: [{ StudyInstanceUID: '2.25.301' }] }, {}, SERVER, {});
  expect(mockDeletePromise).toHaveBeenCalledWith('2.25.301');
});
