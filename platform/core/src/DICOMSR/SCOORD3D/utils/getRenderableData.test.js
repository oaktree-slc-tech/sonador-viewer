// Classic (image coordinate) renderable data: SCOORD3D points are projected onto the image along its
// normal. The matrix this replaced put the slice thickness in all three rows of its third column, so
// oblique planes gave the wrong pixels.

jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('cornerstone-math', () => ({ point: { distance: () => 0 } }), { virtual: true });

import getRenderableData from './getRenderableData';
import { imageToWorld, planeFromInstance } from '../../readOnly/imagePlane';

const c = Math.cos(Math.PI / 6);
const s = Math.sin(Math.PI / 6);
const obliqueInstance = {
  ImagePositionPatient: [10, 20, 30],
  ImageOrientationPatient: [c, s, 0, -s * 0.6, c * 0.6, -0.8],
  PixelSpacing: [0.7, 0.7],
  SliceThickness: 3,
};

it('projects an oblique SCOORD3D Length onto the image it lies in', () => {
  const plane = planeFromInstance(obliqueInstance);
  const GraphicData = [...imageToWorld(plane, [100.5, 40.5]), ...imageToWorld(plane, [180.5, 60.5])];

  const [start, end] = getRenderableData('POLYLINE', GraphicData, 'SCOORD3D', obliqueInstance);
  expect(start.x).toBeCloseTo(100.5, 6);
  expect(start.y).toBeCloseTo(40.5, 6);
  expect(end.x).toBeCloseTo(180.5, 6);
  expect(end.y).toBeCloseTo(60.5, 6);
});

it('passes image (SCOORD) points through and drops SCOORD3D points without a plane', () => {
  expect(getRenderableData('POLYLINE', [1, 2, 3, 4], 'SCOORD', {})).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  expect(getRenderableData('POLYLINE', [1, 2, 3, 4, 5, 6], 'SCOORD3D', {})).toEqual([]);
});
