// An NRRD label volume read into a labelled grid

import { parseNrrd, slicerSegmentFields } from './nrrd';


function fakeVolume(header, data) {
  return { header, data };
}

describe('slicerSegmentFields', () => {
  it('groups Segment<n>_<field> header fields by segment, without the loader\'s leading =', () => {
    const fields = slicerSegmentFields({
      Segment0_Name: '=Femur', Segment0_LabelValue: '=1', Segment10_Layer: '=2', sizes: [1],
    });
    expect(fields.get(0)).toEqual({ Name: 'Femur', LabelValue: '1' });
    expect(fields.get(10)).toEqual({ Layer: '2' });
    expect(fields.size).toBe(2);
  });
});

describe('parseNrrd', () => {
  it('reads a 3D label volume, turned from RAS into LPS, one segment per value', () => {
    const volume = fakeVolume({
      dimension: 3,
      sizes: [2, 2, 2],
      vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
      space: 'right-anterior-superior',
      space_origin: ['1', '2', '3'],
    }, Uint8Array.from([0, 3, 0, 0, 0, 0, 7, 0]));

    const { grid, segments, overlapVoxels } = parseNrrd(new ArrayBuffer(0), { parse: () => volume });

    expect(grid.dimensions).toEqual([2, 2, 2]);
    expect(grid.origin).toEqual([-1, -2, 3]);
    expect(grid.spacing).toEqual([2, 2, 2]);
    expect(grid.direction).toEqual([-1, 0, 0, 0, -1, 0, 0, 0, 1]);
    expect(grid.data).toBe(volume.data);
    expect(segments).toEqual([{ value: 3, label: 'segment-3' }, { value: 7, label: 'segment-7' }]);
    expect(overlapVoxels).toBe(0);
  });

  it('reads a Slicer segmentation: one value per named segment across its layers', () => {
    const volume = fakeVolume({
      dimension: 4,
      sizes: [2, 2, 1, 1],
      vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      space: 'left-posterior-superior',
      Segment0_Name: '=Femur', Segment0_Layer: '=0', Segment0_LabelValue: '=1', Segment0_Color: '=1 0 0',
      Segment1_ID: '=Segment_2', Segment1_Layer: '=1', Segment1_LabelValue: '=1',
    }, Uint8Array.from([
      1, 0,   // voxel 0: layer 0 = 1 (Femur), layer 1 = 0
      1, 1,   // voxel 1: both
    ]));

    const { grid, segments, overlapVoxels } = parseNrrd(new ArrayBuffer(0), { parse: () => volume });

    expect(grid.dimensions).toEqual([2, 1, 1]);
    expect(grid.origin).toEqual([0, 0, 0]);
    expect(Array.from(grid.data)).toEqual([1, 2]);
    expect(overlapVoxels).toBe(1);
    expect(segments).toEqual([
      { value: 1, label: 'Femur', color: [255, 0, 0] },
      { value: 2, label: 'Segment_2' },
    ]);
  });

  it('refuses volumes it cannot place', () => {
    const parse = header => () => fakeVolume(header, new Uint8Array(8));
    expect(() => parseNrrd(null, { parse: parse({ dimension: 2, sizes: [2, 4] }) })).toThrow(/2-dimensional/);
    expect(() => parseNrrd(null, { parse: parse({ dimension: 3, sizes: [2, 2, 2] }) })).toThrow(/no space directions/);
    expect(() => parseNrrd(null, { parse: parse({ dimension: 3, sizes: [2, 2, 2], vectors: [[0, 0, 0], [0, 1, 0], [0, 0, 1]] }) }))
      .toThrow(/zero-length/);
    expect(() => parseNrrd(null, { parse: parse({ dimension: 3, sizes: [4, 4, 4], vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }) }))
      .toThrow(/no voxels/);
  });

  it('reads a real raw NRRD through the three.js loader', () => {
    const header = [
      'NRRD0004', 'type: uint8', 'dimension: 3', 'space: left-posterior-superior', 'sizes: 2 2 2',
      'space directions: (1,0,0) (0,1.5,0) (0,0,2)', 'kinds: domain domain domain', 'encoding: raw',
      'space origin: (10,20,30)', '', '',
    ].join('\n');
    const bytes = new Uint8Array(header.length + 8);
    bytes.set(Array.from(header).map(c => c.charCodeAt(0)));
    bytes.set([0, 0, 0, 5, 0, 0, 0, 0], header.length);

    const { grid, segments } = parseNrrd(bytes.buffer);

    expect(grid.dimensions).toEqual([2, 2, 2]);
    expect(grid.spacing).toEqual([1, 1.5, 2]);
    expect(grid.origin).toEqual([10, 20, 30]);
    expect(grid.data[3]).toBe(5);
    expect(segments).toEqual([{ value: 5, label: 'segment-5' }]);
  });
});
