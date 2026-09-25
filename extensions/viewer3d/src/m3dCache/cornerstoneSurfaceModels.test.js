// Cornerstone3D surface -> Three.js model conversion (Segmentation Editor 3D editing canvas)

import {
  C3D_SURFACE_MODEL_TYPE,
  createSurfaceModel,
  disposeSurfaceModel,
  polysToTriangleIndices,
  surfaceToBufferGeometry,
} from './cornerstoneSurfaceModels';

// The loader pulls in DICOM parsing and the Cornerstone3D geometry loader; only its enum is needed
jest.mock('./m3dGeometryLoader.js', () => ({ M3D_GEOMETRY_TYPE: { STL: 'M3D_STL', GLB: 'M3D_GLB' } }));

// A unit square in z = 0 as two triangles, the shape polymorphic segmentation emits
const square = {
  segmentIndex: 2,
  points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  polys: [3, 0, 1, 2, 3, 0, 2, 3],
};

describe('polysToTriangleIndices', () => {
  it('reads triangle cells', () => {
    expect([...polysToTriangleIndices(square.polys)]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('fans polygons with more than three points', () => {
    expect([...polysToTriangleIndices([4, 0, 1, 2, 3])]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('stops at a truncated or malformed cell', () => {
    expect([...polysToTriangleIndices([3, 0, 1, 2, 3, 4, 5])]).toEqual([0, 1, 2]);
    expect([...polysToTriangleIndices([0, 1, 2])]).toEqual([]);
  });
});

describe('surfaceToBufferGeometry', () => {
  it('builds indexed geometry with normals in world coordinates', () => {
    const geometry = surfaceToBufferGeometry(square);

    expect(geometry.getAttribute('position').count).toBe(4);
    expect([...geometry.index.array]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(geometry.getAttribute('normal').count).toBe(4);
    expect(geometry.boundingBox.max.toArray()).toEqual([1, 1, 0]);
  });

  it('copies the points, so later surface updates do not alias the mesh', () => {
    const geometry = surfaceToBufferGeometry(square);
    expect(geometry.getAttribute('position').array).not.toBe(square.points);
  });
});

describe('createSurfaceModel', () => {
  it('creates an M3DModelView model keyed by the geometry id', () => {
    const model = createSurfaceModel({
      geometryId: 'segmentation_vol3d:seg_surface_2',
      surface: square,
      color: 'rgb(255, 0, 0)',
    });

    expect(model.geometryId).toBe('segmentation_vol3d:seg_surface_2');
    expect(model.segmentIndex).toBe(2);
    expect(model.m3dType).toBe(C3D_SURFACE_MODEL_TYPE);
    expect(model.instance.isMesh).toBe(true);
    expect(model.instance.material.color.getHexString()).toBe('ff0000');
  });

  it('disposes the geometry and material it owns', () => {
    const model = createSurfaceModel({ geometryId: 'g', surface: square });
    const geometryDispose = jest.spyOn(model.instance.geometry, 'dispose');
    const materialDispose = jest.spyOn(model.instance.material, 'dispose');

    disposeSurfaceModel(model);

    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(() => disposeSurfaceModel(undefined)).not.toThrow();
  });
});

describe('VTK lighting model', () => {
  it('uses a two-sided Lambert material with the colour taken as a display value', () => {
    const model = createSurfaceModel({
      geometryId: 'g', surface: square, color: 'rgb(128, 64, 32)', lightingModel: 'vtk',
    });
    const { material } = model.instance;

    expect(material.isMeshLambertMaterial).toBe(true);
    expect(material.side).toBe(2); // DoubleSide: VTK lights both sides
    // Not converted from sRGB: the stored channels are the display values VTK shades with
    expect(material.color.r).toBeCloseTo(128 / 255);
    expect(material.color.g).toBeCloseTo(64 / 255);
    expect(material.color.b).toBeCloseTo(32 / 255);
  });

  it('keeps the M3D viewer material by default', () => {
    const model = createSurfaceModel({ geometryId: 'g', surface: square });
    expect(model.instance.material.isMeshStandardMaterial).toBe(true);
  });
});

