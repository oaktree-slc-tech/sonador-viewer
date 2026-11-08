// Patient-space renderable geometry for read-only measurements.

jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });

import { planeFromInstance, imageToWorld } from './imagePlane';
import { getRenderableData, inPlaneVectors, SHAPES } from './renderableData';

const close = (actual, expected) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));

const axial = planeFromInstance({
  ImagePositionPatient: [-100, -120, 40],
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  PixelSpacing: [0.5, 0.5],
  FrameOfReferenceUID: '2.25.1',
});


describe('getRenderableData', () => {
  it('converts an image (SCOORD) Length to patient points through the image plane', () => {
    const item = getRenderableData({ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [10.5, 20.5, 30.5, 20.5] }, axial);
    expect(item.shape).toBe(SHAPES.POLYLINE);
    close(item.points[0], [-95, -110, 40]);
    close(item.points[1], [-85, -110, 40]);
  });

  it('keeps patient (SCOORD3D) points as written, without a plane', () => {
    const item = getRenderableData({ ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(item.points).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });

  it('cannot place image content without its plane', () => {
    expect(getRenderableData({ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 2, 3, 4] })).toBeNull();
  });

  it('draws an oblique SCOORD3D ellipse as a closed curve through its axis end points', () => {
    // Major axis along (1, 1, 0), minor along z, centred on the origin
    const GraphicData = [-10, -10, 0, 10, 10, 0, 0, 0, -5, 0, 0, 5];
    const item = getRenderableData({ ValueType: 'SCOORD3D', GraphicType: 'ELLIPSE', GraphicData });

    expect(item).toMatchObject({ shape: SHAPES.POLYLINE, closed: true });
    close(item.points[0], [10, 10, 0]);
    close(item.points[item.points.length - 1], [10, 10, 0]);
    expect(item.points.some(p => Math.abs(p[2] - 5) < 1e-6)).toBe(true);
  });

  it('draws a CIRCLE in its image plane', () => {
    const center = [100.5, 100.5];
    const item = getRenderableData({ ValueType: 'SCOORD', GraphicType: 'CIRCLE', GraphicData: [...center, 110.5, 100.5] }, axial);
    const c = imageToWorld(axial, center);
    item.points.forEach(p => {
      expect(Math.hypot(p[0] - c[0], p[1] - c[1])).toBeCloseTo(5, 6);
      expect(p[2]).toBeCloseTo(40, 6);
    });
  });

  it('closes a POLYGON and leaves TEXT and unknown types undrawn', () => {
    const polygon = getRenderableData({ ValueType: 'SCOORD3D', GraphicType: 'POLYGON', GraphicData: [0, 0, 0, 1, 0, 0, 1, 1, 0] });
    expect(polygon.points).toHaveLength(4);
    expect(polygon.points[3]).toEqual([0, 0, 0]);
    expect(getRenderableData({ ValueType: 'SCOORD', GraphicType: 'TEXT', GraphicData: [1, 1] }, axial)).toBeNull();
  });
});


describe('inPlaneVectors', () => {
  it('gives none for a point, one for a line and two for an angle', () => {
    expect(inPlaneVectors([[1, 2, 3]])).toEqual([]);
    expect(inPlaneVectors([[0, 0, 0], [0, 0, 4]])).toEqual([[0, 0, 1]]);

    const [u, v] = inPlaneVectors([[0, 0, 0], [2, 0, 0], [1, 3, 0]]);
    close(u, [1, 0, 0]);
    close(v, [0, 1, 0]);
  });

  it('does not let rounding turn a straight line into a plane', () => {
    expect(inPlaneVectors([[0, 0, 0], [50, 0, 0], [100, 0.00001, 0]])).toHaveLength(1);
  });
});


describe('SCOORD CIRCLE with unequal pixel spacing', () => {
  const expectOnCurve = (item, plane, imagePoint) => {
    const expected = imageToWorld(plane, imagePoint);
    const nearest = Math.min(...item.points.map(p => Math.hypot(p[0] - expected[0], p[1] - expected[1], p[2] - expected[2])));
    expect(nearest).toBeLessThan(1e-6);
  };
  const GraphicData = [10.5, 10.5, 12.5, 10.5];
  const extrema = [[12.5, 10.5], [10.5, 12.5], [8.5, 10.5], [10.5, 8.5]];

  it('covers the image circle at its axis extrema (an ellipse in patient space)', () => {
    const plane = planeFromInstance({
      ImagePositionPatient: [0, 0, 0], ImageOrientationPatient: [1, 0, 0, 0, 1, 0], PixelSpacing: [2, 1],
    });
    const item = getRenderableData({ ValueType: 'SCOORD', GraphicType: 'CIRCLE', GraphicData }, plane);
    extrema.forEach(point => expectOnCurve(item, plane, point));
  });

  it('on an oblique image too', () => {
    const c = Math.cos(Math.PI / 5);
    const s = Math.sin(Math.PI / 5);
    const plane = planeFromInstance({
      ImagePositionPatient: [5, -3, 12], ImageOrientationPatient: [c, s, 0, 0, 0, -1], PixelSpacing: [0.7, 1.4],
    });
    const item = getRenderableData({ ValueType: 'SCOORD', GraphicType: 'CIRCLE', GraphicData }, plane);
    extrema.forEach(point => expectOnCurve(item, plane, point));
  });
});
