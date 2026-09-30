// Import models from STL files and from an M3D series in the study

import { modelLabelFromFileName, modelsFromM3DSeries, modelsFromStlFiles } from './stlModels';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({ cache: {}, utilities: {}, getWebWorkerManager: () => ({}) }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: { state: { getSegmentation: () => undefined }, segmentLocking: {}, triggerSegmentationEvents: {} },
  utilities: { segmentation: {} },
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: () => {} }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { utils: { color: { hex2rgb: hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] } } },
}), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({
  acquireGeometry: jest.fn(),
  releaseGeometry: jest.fn(),
  getM3DGeometryId: sop => `m3d:${sop}`,
  getM3DSegmentationId: uid => `m3dseg:${uid}`,
  getM3DInstanceMetadata: (series, sop) => series?.metadata?.[sop],
  getM3DInstanceLabel: (metadata, index) => metadata?.ContentDescription || `Model ${index}`,
  getM3DInstanceColor: (series, sop) => series?.colors?.[sop],
  listM3DInstanceSources: jest.fn(),
}), { virtual: true });
jest.mock('../threeDTools/registerHoleFillingWorker', () => ({ registerHoleFillingWorker: () => {} }));


const ASCII_STL = [
  'solid tri', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 1 0 0', 'vertex 0 1 0',
  'endloop', 'endfacet', 'endsolid tri',
].join('\n');

function file(name, text) {
  const bytes = Uint8Array.from(Array.from(text).map(c => c.charCodeAt(0)));
  return { name, arrayBuffer: async () => bytes.buffer };
}

// A parsed STL as the geometry cache holds it: a non-indexed BufferGeometry
function geometry(positions) {
  return { getAttribute: name => (name === 'position' ? { array: Float32Array.from(positions) } : undefined) };
}

describe('modelLabelFromFileName', () => {
  it('drops the .stl extension only', () => {
    expect(modelLabelFromFileName('femur.STL')).toBe('femur');
    expect(modelLabelFromFileName('left.tibia.stl')).toBe('left.tibia');
    expect(modelLabelFromFileName('notes.txt')).toBe('notes.txt');
    expect(modelLabelFromFileName('')).toBe('Model');
  });
});

describe('modelsFromStlFiles', () => {
  it('parses each file with the STL loader and names the model after it', async () => {
    const { models } = await modelsFromStlFiles([file('femur.stl', ASCII_STL)]);

    expect(models).toHaveLength(1);
    expect(models[0].label).toBe('femur');
    expect(Array.from(models[0].surface.polys)).toEqual([3, 0, 1, 2]);
    expect(models[0].surface.points).toHaveLength(9);
  });

  it('refuses a file without triangles, and one the loader rejects, by name', async () => {
    const empty = () => geometry([]);
    await expect(modelsFromStlFiles([file('empty.stl', 'solid nothing')], { parse: empty }))
      .rejects.toThrow('empty.stl has no triangles');

    const parse = () => { throw new Error('bad header'); };
    await expect(modelsFromStlFiles([file('notes.stl', 'x')], { parse }))
      .rejects.toThrow('notes.stl is not an STL file (bad header)');
  });
});

describe('modelsFromM3DSeries', () => {
  const displaySet = {
    SeriesInstanceUID: 'series-1',
    m3dModelType: 'model/stl',
    series: {
      metadata: { A: { ContentDescription: 'Meta A' }, B: {} },
      colors: { B: '#0000ff' },
    },
  };
  const sources = [
    { sopInstanceUID: 'A', fetchRawData: jest.fn() },
    { sopInstanceUID: 'B', fetchRawData: jest.fn() },
  ];

  function makeDeps(extra = {}) {
    return {
      listSources: jest.fn(() => sources),
      acquire: jest.fn(async () => ({ parsed: geometry([0, 0, 0, 1, 0, 0, 0, 1, 0]) })),
      release: jest.fn(),
      getSegmentation: jest.fn(() => undefined),
      ...extra,
    };
  }

  it('reads every instance through the cache, named and coloured from the instance metadata', async () => {
    const deps = makeDeps();

    const { models } = await modelsFromM3DSeries({ displaySet, studies: ['studies'], deps });

    expect(deps.listSources).toHaveBeenCalledWith(displaySet, ['studies']);
    expect(deps.acquire.mock.calls.map(([id, holder, options]) => [id, holder, options.mimeType, options.fetchRawData]))
      .toEqual([
        ['m3d:A', 'seg-editor-import', 'model/stl', sources[0].fetchRawData],
        ['m3d:B', 'seg-editor-import', 'model/stl', sources[1].fetchRawData],
      ]);
    expect(deps.release.mock.calls).toEqual([['m3d:A', 'seg-editor-import'], ['m3d:B', 'seg-editor-import']]);
    expect(models.map(m => m.label)).toEqual(['Meta A', 'Model 2']);
    expect(models[0].color).toBeUndefined();
    expect(models[1].color).toEqual([0, 0, 255]);
    expect(Array.from(models[1].surface.polys)).toEqual([3, 0, 1, 2]);
  });

  it('prefers the models panel\'s names and colours when the series is open', async () => {
    const deps = makeDeps({
      getSegmentation: jest.fn(id => (id === 'm3dseg:series-1' ? {
        segments: { 1: { geometryId: 'm3d:B', label: 'Renamed B', color: '#ff0000' } },
      } : undefined)),
    });

    const { models } = await modelsFromM3DSeries({ displaySet, studies: [], deps });

    expect(models.map(m => m.label)).toEqual(['Meta A', 'Renamed B']);
    expect(models[1].color).toEqual([255, 0, 0]);
  });

  it('releases the geometry when reading it fails, and refuses a series without models', async () => {
    const deps = makeDeps({ acquire: jest.fn(async () => ({ parsed: { getAttribute: () => { throw new Error('gone'); } } })) });
    await expect(modelsFromM3DSeries({ displaySet, studies: [], deps })).rejects.toThrow('gone');
    expect(deps.release).toHaveBeenCalledWith('m3d:A', 'seg-editor-import');

    await expect(modelsFromM3DSeries({ displaySet, studies: [], deps: makeDeps({ listSources: () => [] }) }))
      .rejects.toThrow('The series has no models');
  });
});
