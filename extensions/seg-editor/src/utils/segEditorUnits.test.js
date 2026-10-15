// The units of the editor's reference series

import { getSegEditorUnits, instanceHasPixelSpacing, LENGTH_UNITS, unitsOfImages } from './segEditorUnits';

jest.mock('@cornerstonejs/core', () => ({ cache: {}, metaData: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: {} }), { virtual: true });


// Metadata as the viewer's provider gives it: the instance, and the image-plane module built from
// it (Cornerstone3dMetadataProvider: spacing 1 when Pixel Spacing is missing, and
// `usingDefaultValues` raised when spacing, orientation OR position is missing)
const POSITION = [0, 0, 0];
const ORIENTATION = [1, 0, 0, 0, 1, 0];
function provider(instance, { modality = 'MR' } = {}) {
  const spacing = instance?.PixelSpacing;
  const plane = instance && {
    rowPixelSpacing: spacing ? spacing[0] : 1,
    columnPixelSpacing: spacing ? spacing[1] : 1,
    usingDefaultValues: !spacing || !instance.ImageOrientationPatient || !instance.ImagePositionPatient,
  };
  return type => ({
    instance,
    imagePlaneModule: plane,
    generalSeriesModule: { modality },
  })[type];
}

describe('unitsOfImages', () => {
  it('gives millimetres when the images carry their pixel spacing, and HU on CT', () => {
    const get = provider({ PixelSpacing: ['0.7', '0.7'], ImagePositionPatient: POSITION, ImageOrientationPatient: ORIENTATION }, { modality: 'CT' });
    expect(unitsOfImages(['a'], get)).toEqual({ length: LENGTH_UNITS.mm, intensity: 'HU', modality: 'CT' });
  });

  it('keeps millimetres when only the position or orientation was defaulted', () => {
    const noPosition = provider({ PixelSpacing: ['0.7', '0.7'], ImageOrientationPatient: ORIENTATION });
    const noOrientation = provider({ PixelSpacing: ['0.7', '0.7'], ImagePositionPatient: POSITION });
    expect(noPosition('imagePlaneModule').usingDefaultValues).toBe(true);
    expect(unitsOfImages(['a'], noPosition).length).toBe(LENGTH_UNITS.mm);
    expect(unitsOfImages(['a'], noOrientation).length).toBe(LENGTH_UNITS.mm);
  });

  it('tells a real 1 mm spacing from the synthesized spacing of 1', () => {
    const real = provider({ PixelSpacing: ['1', '1'], ImagePositionPatient: POSITION, ImageOrientationPatient: ORIENTATION });
    const synthesized = provider({ ImagePositionPatient: POSITION, ImageOrientationPatient: ORIENTATION });
    expect(synthesized('imagePlaneModule').rowPixelSpacing).toBe(1);
    expect(unitsOfImages(['a'], real).length).toBe(LENGTH_UNITS.mm);
    expect(unitsOfImages(['a'], synthesized)).toEqual({ length: LENGTH_UNITS.generic, intensity: null, modality: 'MR' });
  });

  it('without instance metadata, trusts the image-plane spacing only when nothing was defaulted', () => {
    const plane = usingDefaultValues => type => (type === 'imagePlaneModule'
      ? { rowPixelSpacing: 0.5, columnPixelSpacing: 0.5, usingDefaultValues }
      : undefined);
    expect(unitsOfImages(['a'], plane(false)).length).toBe(LENGTH_UNITS.mm);
    expect(unitsOfImages(['a'], plane(true)).length).toBe(LENGTH_UNITS.generic);
    expect(unitsOfImages(['a'], () => undefined).length).toBe(LENGTH_UNITS.generic);
    expect(unitsOfImages([], () => undefined).length).toBe(LENGTH_UNITS.generic);
  });
});

describe('instanceHasPixelSpacing', () => {
  it('reads Pixel Spacing, Imager Pixel Spacing and the Pixel Measures functional groups', () => {
    expect(instanceHasPixelSpacing({ PixelSpacing: '0.5\\0.5' })).toBe(true);
    expect(instanceHasPixelSpacing({ PixelSpacing: [0.5, 0.5] })).toBe(true);
    expect(instanceHasPixelSpacing({ ImagerPixelSpacing: ['0.14', '0.14'] })).toBe(true);
    expect(instanceHasPixelSpacing({
      SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }],
    })).toBe(true);
    expect(instanceHasPixelSpacing({
      PerFrameFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [0.8, 0.8] }] }],
    })).toBe(true);
  });

  it('refuses missing, partial, zero and non-numeric spacings', () => {
    expect(instanceHasPixelSpacing({})).toBe(false);
    expect(instanceHasPixelSpacing(null)).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: ['0.5'] })).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: [0, 0.5] })).toBe(false);
    expect(instanceHasPixelSpacing({ PixelSpacing: ['x', 'y'] })).toBe(false);
  });
});

describe('getSegEditorUnits', () => {
  it('reads the reference volume of the open editor', () => {
    const units = getSegEditorUnits({
      getContext: () => ({ referenceVolumeId: 'ct' }),
      getVolume: id => (id === 'ct' ? { imageIds: ['a'] } : undefined),
      getMetadata: provider({ PixelSpacing: [0.5, 0.5], ImagePositionPatient: POSITION, ImageOrientationPatient: ORIENTATION }, { modality: 'CT' }),
    });
    expect(units).toMatchObject({ length: 'mm', intensity: 'HU' });
  });

  it('gives generic units while no editor, or no volume, is there', () => {
    expect(getSegEditorUnits({ getContext: () => null }).length).toBe(LENGTH_UNITS.generic);
    expect(getSegEditorUnits({ getContext: () => ({ referenceVolumeId: 'x' }), getVolume: () => undefined }).length)
      .toBe(LENGTH_UNITS.generic);
  });
});
