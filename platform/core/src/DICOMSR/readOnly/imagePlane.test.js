// Image plane geometry for read-only measurements: the conversions match @cornerstonejs/core
// (imageToWorldCoords / worldToImageCoords, 4.22.13), and patient points are matched to the image
// plane that holds them along its normal, at any orientation.

const mockPlaneModules = {};
jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: (type, imageId) => (type === 'imagePlaneModule' ? mockPlaneModules[imageId] : undefined) },
}), { virtual: true });

import {
  distanceFromPlane, findImageForPoints, getImagePlane, imageToWorld, planeFromInstance, worldToImage,
} from './imagePlane';

const close = (actual, expected, digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
};

// Axial, 0.5 mm pixels
const axial = planeFromInstance({
  ImagePositionPatient: [-100, -120, 40],
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  PixelSpacing: [0.5, 0.5],
  FrameOfReferenceUID: '2.25.1',
});

// Oblique: rows turned 30 degrees about the patient z axis, then tilted
const c = Math.cos(Math.PI / 6);
const s = Math.sin(Math.PI / 6);
const oblique = planeFromInstance({
  ImagePositionPatient: [10, 20, 30],
  ImageOrientationPatient: [c, s, 0, 0, 0, -1],
  PixelSpacing: [0.8, 0.8],
  FrameOfReferenceUID: '2.25.1',
});


describe('image <-> patient coordinates', () => {
  it('places the centre of the first pixel at ImagePositionPatient, as Cornerstone3D does', () => {
    close(imageToWorld(axial, [0.5, 0.5]), [-100, -120, 40]);
    close(imageToWorld(axial, [10.5, 20.5]), [-95, -110, 40]);
  });

  it('inverts exactly, on an oblique plane too', () => {
    [[0, 0], [12.25, 7.5], [511.5, 3]].forEach(point => {
      close(worldToImage(axial, imageToWorld(axial, point)), point);
      close(worldToImage(oblique, imageToWorld(oblique, point)), point);
    });
  });

  it('projects an off-plane point along the normal (the old matrix did not)', () => {
    const onPlane = imageToWorld(oblique, [40, 25]);
    const offPlane = onPlane.map((value, i) => value + 2 * oblique.normal[i]);

    close(worldToImage(oblique, offPlane), [40, 25]);
    expect(distanceFromPlane(oblique, offPlane)).toBeCloseTo(2, 6);
  });

  it('prefers the Cornerstone3D plane module, and falls back to the instance', () => {
    mockPlaneModules['wadors:axial'] = {
      imagePositionPatient: [1, 2, 3], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
      rowPixelSpacing: 2, columnPixelSpacing: 2, frameOfReferenceUID: '2.25.9',
    };
    expect(getImagePlane('wadors:axial', { ImagePositionPatient: [9, 9, 9] })).toMatchObject({
      imagePositionPatient: [1, 2, 3], normal: [0, 0, 1], frameOfReferenceUID: '2.25.9',
    });
    expect(getImagePlane('wadors:unknown', {
      ImagePositionPatient: [9, 9, 9], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1],
    })).toMatchObject({ imagePositionPatient: [9, 9, 9] });
    expect(getImagePlane('wadors:unknown', {})).toBeNull();
  });
});


describe('matching patient points to an image', () => {
  // Sagittal slices at x = 0, 2, 4 mm: their distance along the normal is x, not z
  const sagittal = [0, 2, 4].map(x => ({
    SOPInstanceUID: `2.25.${x}`,
    plane: planeFromInstance({
      ImagePositionPatient: [x, -100, 100],
      ImageOrientationPatient: [0, 1, 0, 0, 0, -1],
      PixelSpacing: [1, 1],
      FrameOfReferenceUID: '2.25.1',
    }),
  }));

  it('finds the sagittal slice holding the points (the z coordinate is irrelevant)', () => {
    const match = findImageForPoints(sagittal, [[2, -40, 60], [2.2, 10, -30]], { FrameOfReferenceUID: '2.25.1' });
    expect(match.SOPInstanceUID).toBe('2.25.2');
  });

  it('takes the nearest plane within the tolerance', () => {
    expect(findImageForPoints(sagittal, [[3.4, 0, 0]]).SOPInstanceUID).toBe('2.25.4');
    expect(findImageForPoints(sagittal, [[2.9, 0, 0]]).SOPInstanceUID).toBe('2.25.2');
  });

  it('places nothing when a point leaves every plane, or the Frame of Reference differs', () => {
    expect(findImageForPoints(sagittal, [[2, 0, 0], [3.5, 0, 0]])).toBeUndefined();
    expect(findImageForPoints(sagittal, [[2, 0, 0]], { FrameOfReferenceUID: '2.25.other' })).toBeUndefined();
    expect(findImageForPoints(sagittal, [])).toBeUndefined();
  });
});


describe('Frame of Reference when matching', () => {
  const axialAt = (z, FrameOfReferenceUID) => ({
    id: `${FrameOfReferenceUID || 'unknown'}@${z}`,
    plane: planeFromInstance({
      ImagePositionPatient: [0, 0, z], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [1, 1], FrameOfReferenceUID,
    }),
  });

  it('skips a closer image whose Frame of Reference is unknown', () => {
    const match = findImageForPoints([axialAt(0), axialAt(0.2, 'frame-a')], [[1, 1, 0]], { FrameOfReferenceUID: 'frame-a' });
    expect(match.id).toBe('frame-a@0.2');
  });

  it('places nothing when only unknown-frame images remain', () => {
    expect(findImageForPoints([axialAt(0), axialAt(1)], [[1, 1, 0]], { FrameOfReferenceUID: 'frame-a' })).toBeUndefined();
  });

  it('matches on geometry alone when the content names no Frame of Reference', () => {
    expect(findImageForPoints([axialAt(0)], [[1, 1, 0]]).id).toBe('unknown@0');
  });
});
