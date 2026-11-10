// The image a series-level annotation (a series tag) is added for where there is no classic
// viewport image, as in the MPR view: the first image of the active viewport's display set.

const mockStudy = {
  findDisplaySet: test => [
    { displaySetInstanceUID: 'ds-1', images: [{ getImageId: () => 'wadors:one' }] },
    { displaySetInstanceUID: 'ds-2', images: [{ getImageId: () => 'wadors:two-a' }, { getImageId: () => 'wadors:two-b' }] },
  ].find(test),
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { utils: { studyMetadataManager: { get: uid => (uid === '2.25.1' ? mockStudy : undefined) } } },
}), { virtual: true });

import activeSeriesImageId from './activeSeriesImageId';

it('gives the first image of the active viewport\'s display set', () => {
  const viewports = {
    activeViewportIndex: 1,
    viewportSpecificData: {
      0: { StudyInstanceUID: '2.25.1', displaySetInstanceUID: 'ds-1' },
      1: { StudyInstanceUID: '2.25.1', displaySetInstanceUID: 'ds-2' },
    },
  };
  expect(activeSeriesImageId(viewports)).toBe('wadors:two-a');
});

it('gives nothing without an active display set, or one the study does not hold', () => {
  expect(activeSeriesImageId({ activeViewportIndex: 0, viewportSpecificData: {} })).toBeUndefined();
  expect(activeSeriesImageId({ activeViewportIndex: 0, viewportSpecificData: { 0: { StudyInstanceUID: '2.25.9', displaySetInstanceUID: 'ds-1' } } })).toBeUndefined();
  expect(activeSeriesImageId({ activeViewportIndex: 0, viewportSpecificData: { 0: { StudyInstanceUID: '2.25.1', displaySetInstanceUID: 'ds-9' } } })).toBeUndefined();
});
