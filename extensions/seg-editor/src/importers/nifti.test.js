// A NIfTI label volume read into a labelled grid

import { decodeVoxels, parseNifti, spatialUnitToMm } from './nifti';


function fakeReader({ compressed = false, header, image }) {
  return {
    isCompressed: jest.fn(() => compressed),
    decompress: jest.fn(data => data),
    isNIFTI: jest.fn(() => !!header),
    readHeader: jest.fn(() => header),
    readImage: jest.fn(() => image),
  };
}

const UNIT_RAS_AFFINE = [[-1, 0, 0, 10], [0, -1, 0, 20], [0, 0, 1, 30], [0, 0, 0, 1]];

describe('parseNifti', () => {
  it('reads the voxels by datatype and places them in LPS from the RAS affine', () => {
    const reader = fakeReader({
      header: { dims: [3, 2, 2, 2], datatypeCode: 2, affine: UNIT_RAS_AFFINE },
      image: Uint8Array.from([0, 4, 0, 0, 0, 0, 4, 9]).buffer,
    });

    const { grid, segments } = parseNifti(new ArrayBuffer(0), { reader });

    expect(grid.dimensions).toEqual([2, 2, 2]);
    expect(grid.origin).toEqual([-10, -20, 30]);
    expect(grid.spacing).toEqual([1, 1, 1]);
    expect(grid.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(grid.data)).toEqual([0, 4, 0, 0, 0, 0, 4, 9]);
    expect(segments).toEqual([{ value: 4, label: 'segment-4' }, { value: 9, label: 'segment-9' }]);
    expect(reader.decompress).not.toHaveBeenCalled();
  });

  it('decompresses a gzipped file, reads 16-bit voxels and only the first volume of a 4D file', () => {
    const image = Int16Array.from([0, 2, 2, 0, 7, 7, 7, 7]).buffer;   // 2 volumes of 4 voxels
    const reader = fakeReader({
      compressed: true,
      header: { dims: [4, 2, 2, 1, 2], datatypeCode: 4, affine: [[2, 0, 0, 0], [0, 0, -3, 0], [0, 3, 0, 5], [0, 0, 0, 1]] },
      image,
    });

    const { grid, segments } = parseNifti(new ArrayBuffer(0), { reader });

    expect(reader.decompress).toHaveBeenCalled();
    expect(Array.from(grid.data)).toEqual([0, 2, 2, 0]);
    expect(segments).toEqual([{ value: 2, label: 'segment-2' }]);
    // Column axes of the affine, x and y negated: (2,0,0) -> (-2,0,0); (0,0,3) -> (0,0,3); (0,-3,0) -> (0,3,0)
    expect(grid.spacing).toEqual([2, 3, 3]);
    expect(grid.direction).toEqual([-1, 0, 0, 0, 0, 1, 0, 1, 0]);
    expect(grid.origin).toEqual([0, 0, 5]);
  });

  it('decodes a big-endian file in its own byte order', () => {
    const image = Uint8Array.from([0, 1, 0, 2, 1, 0, 0, 0]).buffer;   // big-endian uint16: 1, 2, 256, 0
    const reader = fakeReader({
      header: { dims: [3, 2, 2, 1], datatypeCode: 512, littleEndian: false, affine: UNIT_RAS_AFFINE },
      image,
    });

    const { grid, segments } = parseNifti(new ArrayBuffer(0), { reader });

    expect(Array.from(grid.data)).toEqual([1, 2, 256, 0]);
    expect(segments.map(s => s.value)).toEqual([1, 2, 256]);
    expect(Array.from(decodeVoxels(image, Uint16Array, { littleEndian: true, count: 4 }))).toEqual([256, 512, 1, 0]);
  });

  it('brings a metre or micron affine to millimetres', () => {
    const metres = { dims: [3, 2, 2, 2], datatypeCode: 2, xyzt_units: 1 | 8, affine: [[-0.001, 0, 0, 0.1], [0, -0.001, 0, 0], [0, 0, 0.001, 0], [0, 0, 0, 1]] };
    const reader = fakeReader({ header: metres, image: new Uint8Array(8).buffer });

    const { grid } = parseNifti(new ArrayBuffer(0), { reader });

    expect(grid.spacing).toEqual([1, 1, 1]);
    expect(grid.origin).toEqual([-100, 0, 0]);
    expect(spatialUnitToMm({ xyzt_units: 3 })).toBe(0.001);
    expect(spatialUnitToMm({ xyzt_units: 2 })).toBe(1);
    expect(spatialUnitToMm({})).toBe(1);
    expect(() => spatialUnitToMm({ xyzt_units: 5 })).toThrow(/unit 5/);
  });

  it('refuses what it cannot read', () => {
    expect(() => parseNifti(new ArrayBuffer(0), { reader: fakeReader({}) })).toThrow('Not a NIfTI file');
    expect(() => parseNifti(new ArrayBuffer(0), {
      reader: fakeReader({ header: { dims: [3, 2, 2, 2], datatypeCode: 1234, affine: UNIT_RAS_AFFINE }, image: new ArrayBuffer(8) }),
    })).toThrow(/datatype 1234/);
    expect(() => parseNifti(new ArrayBuffer(0), {
      reader: fakeReader({ header: { dims: [3, 2, 2, 2], datatypeCode: 2, affine: UNIT_RAS_AFFINE }, image: new ArrayBuffer(4) }),
    })).toThrow(/shorter than its dimensions/);
    expect(() => parseNifti(new ArrayBuffer(0), {
      reader: fakeReader({ header: { dims: [2, 2, 2, 0], datatypeCode: 2, affine: UNIT_RAS_AFFINE }, image: new ArrayBuffer(4) }),
    })).toThrow(/no voxels/);
  });
});
