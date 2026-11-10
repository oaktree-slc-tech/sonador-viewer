// The units of the editor's reference series, and the provenance of the answer (ohif-viewers#151)

import { clearSegEditorToolContext, setSegEditorToolContext } from '../toolbox/segEditorToolContext';

import {
  CALIBRATION,
  clearSegEditorUnitsCache,
  GENERIC_UNIT_HINT,
  getSegEditorUnits,
  instanceHasPixelSpacing,
  instanceSpacing,
  invalidateSegEditorUnits,
  LENGTH_UNITS,
  SPACING_SOURCE,
  subscribeSegEditorUnits,
  unitHintFor,
  unitsOfImages,
  UNKNOWN_REASON,
} from './segEditorUnits';

jest.mock('@cornerstonejs/core', () => ({
  cache: {},
  metaData: {},
  eventTarget: { addEventListener: () => {}, removeEventListener: () => {} },
  Enums: { Events: { VOLUME_CACHE_VOLUME_ADDED: 'added', VOLUME_CACHE_VOLUME_REMOVED: 'removed' } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: { getToolGroup: () => undefined } }), { virtual: true });


// Metadata as the viewer's provider gives it: the instance, and the image-plane module built from
// it (Cornerstone3dMetadataProvider: spacing 1 when Pixel Spacing is missing, and
// `usingDefaultValues` raised when spacing, orientation OR position is missing). On a projection
// image the core's getPixelSpacingInformation substitutes Imager Pixel Spacing for a missing Pixel
// Spacing, with nothing defaulted.
const POSITION = [0, 0, 0];
const ORIENTATION = [1, 0, 0, 0, 1, 0];
function provider(instance, { modality = 'MR' } = {}) {
  const spacing = instance?.PixelSpacing || instance?.ImagerPixelSpacing;
  const plane = instance && {
    rowPixelSpacing: spacing ? Number(spacing[0]) : 1,
    columnPixelSpacing: spacing ? Number(spacing[1]) : 1,
    usingDefaultValues: !spacing || !instance.ImageOrientationPatient || !instance.ImagePositionPatient,
  };
  return type => ({
    instance,
    imagePlaneModule: plane,
    generalSeriesModule: { modality },
  })[type];
}
const placed = { ImagePositionPatient: POSITION, ImageOrientationPatient: ORIENTATION };

describe('unitsOfImages', () => {
  it('gives millimetres from Pixel Spacing, with its provenance, and HU on CT', () => {
    const get = provider({ PixelSpacing: ['0.7', '0.7'], ...placed }, { modality: 'CT' });
    expect(unitsOfImages(['a'], get)).toEqual({
      length: LENGTH_UNITS.mm,
      intensity: 'HU',
      modality: 'CT',
      calibration: CALIBRATION.mm,
      source: SPACING_SOURCE.pixelSpacing,
      reason: null,
      planeSpacing: [0.7, 0.7],
      detectorSpacing: null,
      spacing: null,
    });
  });

  it('keeps millimetres when only the position or orientation was defaulted', () => {
    const noPosition = provider({ PixelSpacing: ['0.7', '0.7'], ImageOrientationPatient: ORIENTATION });
    const noOrientation = provider({ PixelSpacing: ['0.7', '0.7'], ImagePositionPatient: POSITION });
    expect(noPosition('imagePlaneModule').usingDefaultValues).toBe(true);
    expect(unitsOfImages(['a'], noPosition).length).toBe(LENGTH_UNITS.mm);
    expect(unitsOfImages(['a'], noOrientation).length).toBe(LENGTH_UNITS.mm);
  });

  it('tells a real 1 mm spacing from the synthesized spacing of 1', () => {
    const real = provider({ PixelSpacing: ['1', '1'], ...placed });
    const synthesized = provider({ ...placed });
    expect(synthesized('imagePlaneModule').rowPixelSpacing).toBe(1);
    expect(unitsOfImages(['a'], real).length).toBe(LENGTH_UNITS.mm);
    expect(unitsOfImages(['a'], synthesized)).toMatchObject({
      length: LENGTH_UNITS.generic,
      intensity: null,
      modality: 'MR',
      calibration: CALIBRATION.unknown,
      source: SPACING_SOURCE.none,
      reason: UNKNOWN_REASON.noSpacing,
    });
  });

  it('does not take a detector spacing for a patient calibration (FR-1)', () => {
    // A radiograph with Imager Pixel Spacing only: the plane module reports that spacing with
    // nothing defaulted, and the resolver still says unknown, naming the detector as the reason
    const get = provider({ ImagerPixelSpacing: ['0.14', '0.14'], SOPClassUID: '1.2.840.10008.5.1.4.1.1.1.1', ...placed }, { modality: 'DX' });
    expect(get('imagePlaneModule')).toMatchObject({ rowPixelSpacing: 0.14, usingDefaultValues: false });
    expect(unitsOfImages(['a'], get)).toMatchObject({
      length: LENGTH_UNITS.generic,
      calibration: CALIBRATION.unknown,
      reason: UNKNOWN_REASON.detectorOnly,
      planeSpacing: null,
      detectorSpacing: [0.14, 0.14],
    });
  });

  it('calibrates from Pixel Spacing when both spacings are present, and keeps the detector spacing apart', () => {
    const get = provider({ PixelSpacing: ['0.2', '0.2'], ImagerPixelSpacing: ['0.14', '0.14'], ...placed });
    expect(unitsOfImages(['a'], get)).toMatchObject({
      calibration: CALIBRATION.mm,
      source: SPACING_SOURCE.pixelSpacing,
      planeSpacing: [0.2, 0.2],
      detectorSpacing: [0.14, 0.14],
    });
  });

  it('calibrates an enhanced object from its Pixel Measures, shared or per-frame', () => {
    const shared = provider({ SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }], ...placed });
    const perFrame = provider({ PerFrameFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: '0.9\\0.9' }] }], ...placed });
    expect(unitsOfImages(['a'], shared)).toMatchObject({ calibration: CALIBRATION.mm, source: SPACING_SOURCE.pixelMeasures, planeSpacing: [0.8, 0.8] });
    expect(unitsOfImages(['a'], perFrame)).toMatchObject({ calibration: CALIBRATION.mm, source: SPACING_SOURCE.pixelMeasures, planeSpacing: [0.9, 0.9] });
  });

  it('refuses a malformed spacing and says so', () => {
    const malformed = provider({ PixelSpacing: ['0.5', 'abc'], ...placed });
    const zero = provider({ PixelSpacing: [0, 0.5], ...placed });
    expect(unitsOfImages(['a'], malformed)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.invalid });
    expect(unitsOfImages(['a'], zero)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.invalid });
    // ... unless a valid one follows in the functional groups
    const recovered = provider({
      PixelSpacing: ['x', 'y'],
      SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }],
      ...placed,
    });
    expect(unitsOfImages(['a'], recovered)).toMatchObject({ calibration: CALIBRATION.mm, source: SPACING_SOURCE.pixelMeasures });
  });

  it('without instance metadata, trusts the image-plane spacing only when nothing was defaulted', () => {
    const plane = usingDefaultValues => type => (type === 'imagePlaneModule'
      ? { rowPixelSpacing: 0.5, columnPixelSpacing: 0.5, usingDefaultValues }
      : undefined);
    expect(unitsOfImages(['a'], plane(false))).toMatchObject({ length: LENGTH_UNITS.mm, source: SPACING_SOURCE.imagePlane, planeSpacing: [0.5, 0.5] });
    expect(unitsOfImages(['a'], plane(true))).toMatchObject({ length: LENGTH_UNITS.generic, reason: UNKNOWN_REASON.defaulted });
    expect(unitsOfImages(['a'], plane(undefined))).toMatchObject({ length: LENGTH_UNITS.generic, reason: UNKNOWN_REASON.defaulted });
    expect(unitsOfImages(['a'], () => undefined)).toMatchObject({ length: LENGTH_UNITS.generic, reason: UNKNOWN_REASON.noMetadata });
    expect(unitsOfImages([], () => undefined)).toMatchObject({ length: LENGTH_UNITS.generic, reason: UNKNOWN_REASON.noMetadata });
  });

  it('records the grid steps whatever the calibration', () => {
    const calibrated = provider({ PixelSpacing: ['0.5', '0.5'], ...placed });
    const unknown = provider({ ...placed });
    expect(unitsOfImages(['a'], calibrated, { spacing: [0.5, 0.5, 3] }).spacing).toEqual([0.5, 0.5, 3]);
    expect(unitsOfImages(['a'], unknown, { spacing: [1, 1, 1] }).spacing).toEqual([1, 1, 1]);
  });
});

describe('instanceSpacing / instanceHasPixelSpacing', () => {
  it('reads Pixel Spacing and the Pixel Measures functional groups as the plane spacing', () => {
    expect(instanceHasPixelSpacing({ PixelSpacing: '0.5\\0.5' })).toBe(true);
    expect(instanceHasPixelSpacing({ PixelSpacing: [0.5, 0.5] })).toBe(true);
    expect(instanceHasPixelSpacing({
      SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }],
    })).toBe(true);
    expect(instanceHasPixelSpacing({
      PerFrameFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }],
    })).toBe(true);
  });

  it('keeps Imager Pixel Spacing as the detector spacing, not a plane spacing', () => {
    expect(instanceHasPixelSpacing({ ImagerPixelSpacing: ['0.14', '0.14'] })).toBe(false);
    expect(instanceSpacing({ ImagerPixelSpacing: ['0.14', '0.14'] })).toEqual({
      plane: null, source: SPACING_SOURCE.none, detector: [0.14, 0.14], invalid: false,
    });
    // A malformed detector spacing is dropped, not an error
    expect(instanceSpacing({ ImagerPixelSpacing: ['0.14'] }).detector).toBeNull();
  });

  it('refuses missing, partial, zero and non-numeric spacings', () => {
    expect(instanceHasPixelSpacing({})).toBe(false);
    expect(instanceHasPixelSpacing(null)).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: ['0.5'] })).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: [0, 0.5] })).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: ['x', 'y'] })).toBe(false);
    expect(instanceSpacing({ PixelSpacing: ['x', 'y'] }).invalid).toBe(true);
    expect(instanceSpacing({}).invalid).toBe(false);
  });
});

describe('unitHintFor', () => {
  it('explains an unknown calibration by its reason, and says nothing for millimetres', () => {
    expect(unitHintFor(unitsOfImages(['a'], provider({ PixelSpacing: ['0.5', '0.5'], ...placed })))).toBeUndefined();
    expect(unitHintFor(unitsOfImages(['a'], provider({ ...placed })))).toBe(GENERIC_UNIT_HINT);
    expect(unitHintFor(unitsOfImages(['a'], provider({ ImagerPixelSpacing: ['0.14', '0.14'], ...placed })))).toMatch(/detector/);
    expect(unitHintFor(unitsOfImages(['a'], provider({ PixelSpacing: ['x', 'y'], ...placed })))).toMatch(/two positive numbers/);
    expect(unitHintFor(undefined)).toBeUndefined();
  });
});

describe('getSegEditorUnits', () => {
  beforeEach(() => clearSegEditorUnitsCache());

  it('reads the reference volume of the open editor, with its grid steps', () => {
    const units = getSegEditorUnits({
      records: new Map(),
      getContext: () => ({ referenceVolumeId: 'ct' }),
      getVolume: id => (id === 'ct' ? { imageIds: ['a'], spacing: [0.5, 0.5, 3] } : undefined),
      getMetadata: provider({ PixelSpacing: [0.5, 0.5], ...placed }, { modality: 'CT' }),
    });
    expect(units).toMatchObject({ length: 'mm', intensity: 'HU', calibration: CALIBRATION.mm, spacing: [0.5, 0.5, 3] });
  });

  it('keeps one record per reference volume while its geometry is the same', () => {
    const records = new Map();
    const volume = { imageIds: ['a'], spacing: [1, 1, 1] };
    const metadata = jest.fn(provider({ PixelSpacing: [1, 1], ...placed }));
    const deps = { records, getContext: () => ({ referenceVolumeId: 'v1' }), getVolume: () => volume, getMetadata: metadata };
    const first = getSegEditorUnits(deps);
    const reads = metadata.mock.calls.length;
    expect(getSegEditorUnits(deps)).toBe(first);
    // Decided from the instance's attributes: not read again
    expect(metadata.mock.calls.length).toBe(reads);
    // Another volume id is another record
    getSegEditorUnits({ ...deps, getContext: () => ({ referenceVolumeId: 'v2' }) });
    expect(records.size).toBe(2);
  });

  it('reads the geometry again when the volume is replaced under the same id', () => {
    const records = new Map();
    const volume = { current: { imageIds: ['a'], spacing: [1, 1, 2] } };
    const deps = { records, getContext: () => ({ referenceVolumeId: 'v' }), getVolume: () => volume.current, getMetadata: provider({ ...placed }) };
    expect(getSegEditorUnits(deps).spacing).toEqual([1, 1, 2]);
    // The lease released the volume and it came back, under the same id, on a coarser grid
    volume.current = { imageIds: ['a'], spacing: [3, 3, 6] };
    expect(getSegEditorUnits(deps).spacing).toEqual([3, 3, 6]);
    // The same object with its grid changed in place
    volume.current.spacing = [2, 2, 4];
    expect(getSegEditorUnits(deps).spacing).toEqual([2, 2, 4]);
    // Another image list on the same object
    volume.current.imageIds = ['b'];
    getSegEditorUnits(deps);
    expect(records.get('v').imageIds).toEqual(['b']);
  });

  it('drops the record of an evicted volume, and reads the recreated one afresh', () => {
    const records = new Map();
    const volume = { current: { imageIds: ['a'], spacing: [0.5, 0.5, 1] } };
    const getMetadata = { current: provider({ PixelSpacing: [0.5, 0.5], ...placed }) };
    const deps = { records, getContext: () => ({ referenceVolumeId: 'v' }), getVolume: () => volume.current, getMetadata: (...args) => getMetadata.current(...args) };
    expect(getSegEditorUnits(deps).calibration).toBe(CALIBRATION.mm);
    volume.current = undefined;
    expect(getSegEditorUnits(deps).calibration).toBe(CALIBRATION.unknown);
    expect(records.has('v')).toBe(false);
    volume.current = { imageIds: ['c'], spacing: [1, 1, 1] };
    getMetadata.current = provider({ ...placed });
    expect(getSegEditorUnits(deps)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.noSpacing, spacing: [1, 1, 1] });
  });

  it('reads again a record decided before the metadata arrived, keeping it while unchanged', () => {
    const records = new Map();
    const volume = { imageIds: ['a'], spacing: [0.5, 0.5, 1] };
    const getMetadata = { current: () => undefined };
    const deps = { records, getContext: () => ({ referenceVolumeId: 'v' }), getVolume: () => volume, getMetadata: (...args) => getMetadata.current(...args) };
    const first = getSegEditorUnits(deps);
    expect(first.reason).toBe(UNKNOWN_REASON.noMetadata);
    expect(getSegEditorUnits(deps)).toBe(first);
    getMetadata.current = provider({ PixelSpacing: [0.5, 0.5], ...placed });
    expect(getSegEditorUnits(deps)).toMatchObject({ calibration: CALIBRATION.mm, planeSpacing: [0.5, 0.5] });
  });

  it('tells its listeners when a volume enters or leaves the cache, and drops that record', () => {
    const listeners = {};
    const eventTarget = {
      addEventListener: jest.fn((name, listener) => { listeners[name] = listener; }),
      removeEventListener: jest.fn(name => { delete listeners[name]; }),
    };
    const heard = jest.fn();
    const volume = { imageIds: ['a'], spacing: [1, 1, 1] };
    getSegEditorUnits({ getContext: () => ({ referenceVolumeId: 'v' }), getVolume: () => volume, getMetadata: provider({ ...placed }) });
    const unsubscribe = subscribeSegEditorUnits(heard, { eventTarget });
    listeners.removed({ detail: { volumeId: 'v' } });
    expect(heard).toHaveBeenCalledTimes(1);
    // Nothing cached for it any more, and no editor has it for its reference: nothing to tell
    listeners.added({ detail: { volume: { volumeId: 'v' } } });
    expect(heard).toHaveBeenCalledTimes(1);
    // The editor's reference coming back is told, cached or not
    invalidateSegEditorUnits('v', { getContext: () => ({ referenceVolumeId: 'v' }) });
    expect(heard).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(eventTarget.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('publishes the absent reference once a removal completes, though the event comes before the volume leaves the cache', async () => {
    // Cornerstone3D's cache as it removes a volume at 4.22.13 (Cache.removeVolumeLoadObject): the
    // removal is announced with the volume still cached, and decached after the listeners ran
    const listeners = {};
    const eventTarget = {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      removeEventListener: name => { delete listeners[name]; },
    };
    const volumes = new Map();
    const cache = {
      put(volumeId, volume) {
        volumes.set(volumeId, volume);
        listeners.added?.({ detail: { volume: { volumeId, volume } } });
      },
      remove(volumeId) {
        listeners.removed?.({ detail: { volume: { volumeId, volume: volumes.get(volumeId) }, volumeId } });
        volumes.delete(volumeId);
      },
    };
    const deps = { getVolume: id => volumes.get(id), getMetadata: provider({ PixelSpacing: [0.5, 0.5], ...placed }) };
    setSegEditorToolContext({ toolGroupId: 'tools', viewportIds: [], segmentationId: 'work', referenceVolumeId: 'v' });
    try {
      cache.put('v', { imageIds: ['a'], spacing: [0.5, 0.5, 1] });
      // What the palette and the canvas hold: the units read on each notification
      let published = getSegEditorUnits(deps);
      const unsubscribe = subscribeSegEditorUnits(() => { published = getSegEditorUnits(deps); }, { eventTarget });
      expect(published).toMatchObject({ calibration: CALIBRATION.mm, spacing: [0.5, 0.5, 1] });

      cache.remove('v');
      // While the removal was announced the volume was still cached: it was already read as gone
      expect(published).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.noMetadata, spacing: null });
      await Promise.resolve();
      expect(volumes.has('v')).toBe(false);
      expect(published).toMatchObject({ calibration: CALIBRATION.unknown, spacing: null });

      // Recreated under the same id on another grid: its geometry is published
      cache.put('v', { imageIds: ['b'], spacing: [2, 2, 4] });
      expect(published).toMatchObject({ calibration: CALIBRATION.mm, spacing: [2, 2, 4] });
      // A removal and a recreation in the same turn end on the recreated volume
      cache.remove('v');
      cache.put('v', { imageIds: ['c'], spacing: [3, 3, 3] });
      await Promise.resolve();
      expect(published).toMatchObject({ calibration: CALIBRATION.mm, spacing: [3, 3, 3] });
      unsubscribe();
    } finally {
      clearSegEditorToolContext('tools');
    }
  });

  it('does not cache while the volume has not loaded', () => {
    const records = new Map();
    const volume = { current: undefined };
    const deps = { records, getContext: () => ({ referenceVolumeId: 'v' }), getVolume: () => volume.current, getMetadata: provider({ PixelSpacing: [0.5, 0.5], ...placed }) };
    expect(getSegEditorUnits(deps).length).toBe(LENGTH_UNITS.generic);
    expect(records.size).toBe(0);
    volume.current = { imageIds: ['a'], spacing: [0.5, 0.5, 0.5] };
    expect(getSegEditorUnits(deps).length).toBe(LENGTH_UNITS.mm);
  });

  it('gives generic units while no editor, or no volume, is there', () => {
    expect(getSegEditorUnits({ records: new Map(), getContext: () => null }).length).toBe(LENGTH_UNITS.generic);
    expect(getSegEditorUnits({ records: new Map(), getContext: () => ({ referenceVolumeId: 'x' }), getVolume: () => undefined }).length)
      .toBe(LENGTH_UNITS.generic);
  });
});
