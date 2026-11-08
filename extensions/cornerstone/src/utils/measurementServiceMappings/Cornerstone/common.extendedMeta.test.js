// A Cornerstone3D Length hydrated from a report reaches the classic tool with its extended meta
// (description, location, text) and display colours, the properties the Measurements panel shows.

jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ utilities: {}, metaData: {} }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: { Enums: {}, getImagePath: () => 'image-path' },
    utils: { dataProc: { firstDefinedValue: (...values) => values.find(value => value !== undefined) }, guid: () => 'guid' },
    log: { warn: () => {}, info: () => {}, debug: () => {} },
  },
}), { virtual: true });

import { measurementServiceMappingTools } from './common';

const { commonToAnnotation } = measurementServiceMappingTools;

// The measurement as the Cornerstone3D Length mapping returns it, with the metadata the report
// parser put on the annotation
const hydratedLength = {
  uid: 'm-1',
  points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
  SOPInstanceUID: '2.25.900',
  referencedImageId: 'wadors:image',
  displayAttributes: { Color: { Background: '#3366cc' } },
  data: { 'imageId:wadors:image': { length: 41.5 } },
  metadata: {
    _id: 'cs-1', description: 'MRI: Patella', location: 'Bone', text: 'Proximal third',
    TrackingUniqueIdentifier: '2.25.1', SeriesInstanceUID: '2.25.2', StudyInstanceUID: '2.25.3',
  },
};

it('keeps the description, location, text and display colours', () => {
  const { measurementData } = commonToAnnotation({}, hydratedLength, 'Length');

  expect(measurementData).toMatchObject({
    description: 'MRI: Patella',
    location: 'Bone',
    text: 'Proximal third',
    displayAttributes: { Color: { Background: '#3366cc' } },
  });
});

it('adds no display attributes to a measurement without them', () => {
  const { measurementData } = commonToAnnotation({}, { ...hydratedLength, displayAttributes: undefined }, 'Length');
  expect(measurementData).not.toHaveProperty('displayAttributes');
});
