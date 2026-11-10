// A measurement added to the measurement API takes its image attributes from the element's image,
// or, without a classic element (a series tag added in the MPR view), from the image the event names.

const mockInstance = {
  '2.25.1': { StudyInstanceUID: '2.25.1', PatientID: 'P', SeriesInstanceUID: '2.25.2', SOPInstanceUID: '2.25.3' },
};
jest.mock('cornerstone-core', () => ({
  metaData: { get: (type, imageId) => (type === 'instance' ? mockInstance[imageId === 'wadors:a' ? '2.25.1' : ''] : undefined) },
  getEnabledElement: () => { throw new Error('no element'); },
}), { virtual: true });
const mockApi = {
  tools: { DICOMSRSeriesTagTool: [] },
  _serviceManagedTool: () => ({ toolServiceManaged: false }),
  addMeasurementRepresentation: jest.fn((toolType, measurement) => ({ _id: 'm1', ...measurement })),
};
jest.mock('../classes', () => ({ MeasurementApi: { get Instance() { return mockApi; } } }));
jest.mock('../../user', () => ({ __esModule: true, default: { getUserId: () => 'u' } }));
jest.mock('../lib/refreshCornerstoneViewports', () => ({ __esModule: true, default: () => {} }));
jest.mock('../lib/getLabel', () => ({ __esModule: true, default: () => undefined }));

import handleSingleMeasurementAdded from './handleSingleMeasurementAdded';

it('adds a measurement for the image the event names, without an element', () => {
  const measurementData = { value: 'tag' };
  handleSingleMeasurementAdded({ eventData: { toolType: 'DICOMSRSeriesTagTool', measurementData, imageId: 'wadors:a' } });
  expect(mockApi.addMeasurementRepresentation).toHaveBeenCalledWith('DICOMSRSeriesTagTool', expect.objectContaining({
    StudyInstanceUID: '2.25.1', SeriesInstanceUID: '2.25.2', SOPInstanceUID: '2.25.3', value: 'tag',
  }));
  expect(measurementData._id).toBe('m1');
});
