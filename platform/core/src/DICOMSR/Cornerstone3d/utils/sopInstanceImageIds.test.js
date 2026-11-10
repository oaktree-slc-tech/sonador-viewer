// SOP instance -> image id map for report hydration, derived the way the viewports derive ids

const mockProviders = [];
jest.mock('@cornerstonejs/core', () => ({
  metaData: { addProvider: (provider, priority) => mockProviders.push({ provider, priority }) },
}), { virtual: true });
jest.mock('../../../classes/MetadataProvider', () => ({ __esModule: true, default: { addImageIdToUIDs: jest.fn() } }));
jest.mock('../../../classes/Cornerstone3dMetadataProvider', () => ({ __esModule: true, default: { addImageIdToUIDs: jest.fn() } }));
jest.mock('../../../utils/getImageId', () => ({
  __esModule: true,
  default: (image, frame) => `id:${image.metadata.SOPInstanceUID}${frame === undefined ? '' : ':' + frame}`,
}));

const { buildSopInstanceImageIds } = require('./sopInstanceImageIds');
const legacyProvider = require('../../../classes/MetadataProvider').default;
const c3dProvider = require('../../../classes/Cornerstone3dMetadataProvider').default;

// An InstanceMetadata-like wrapper over the loader's instance object
const wrapper = (SOPInstanceUID, NumberOfFrames) => ({
  getData: () => ({ metadata: { StudyInstanceUID: 'study', SeriesInstanceUID: 'series', SOPInstanceUID, NumberOfFrames }, wadorsuri: 'x' }),
});

beforeEach(() => jest.clearAllMocks());

describe('buildSopInstanceImageIds', () => {
  it('maps single-frame instances to the id the stack would use, and registers it', () => {
    const { sopInstanceUIDToImageId, imageIdsForToolState } = buildSopInstanceImageIds([{ images: [wrapper('a'), wrapper('b')] }]);

    expect(sopInstanceUIDToImageId).toEqual({ a: 'id:a', b: 'id:b' });
    expect(imageIdsForToolState.a[1]).toBe('id:a');
    expect(legacyProvider.addImageIdToUIDs).toHaveBeenCalledWith('id:a', { StudyInstanceUID: 'study', SeriesInstanceUID: 'series', SOPInstanceUID: 'a' });
    expect(c3dProvider.addImageIdToUIDs).toHaveBeenCalledWith('id:a', { StudyInstanceUID: 'study', SeriesInstanceUID: 'series', SOPInstanceUID: 'a' });
  });

  it('maps every frame of a multiframe instance by DICOM frame number, first frame as the instance id', () => {
    const { sopInstanceUIDToImageId, imageIdsForToolState } = buildSopInstanceImageIds([{ images: [wrapper('m', 3)] }]);

    expect(imageIdsForToolState.m[1]).toBe('id:m:0');
    expect(imageIdsForToolState.m[3]).toBe('id:m:2');
    expect(sopInstanceUIDToImageId.m).toBe('id:m:0');
    expect(c3dProvider.addImageIdToUIDs).toHaveBeenCalledWith('id:m:1', expect.objectContaining({ SOPInstanceUID: 'm', frameIndex: 1 }));
  });

  it('accepts plain instance objects, keeps the first display set that holds a SOP, and skips what it cannot build', () => {
    const plain = { metadata: { SOPInstanceUID: 'p', StudyInstanceUID: 's', SeriesInstanceUID: 'r' } };
    const { sopInstanceUIDToImageId } = buildSopInstanceImageIds(
      [{ instances: [plain] }, { images: [wrapper('p')] }, { images: [{ getData: () => ({ metadata: {} }) }] }],
      { register: false });

    expect(sopInstanceUIDToImageId).toEqual({ p: 'id:p' });
    expect(legacyProvider.addImageIdToUIDs).not.toHaveBeenCalled();
  });
});


describe('the image plane fallback', () => {
  const imaged = (SOPInstanceUID, tags) => ({
    getData: () => ({ metadata: { StudyInstanceUID: 'study', SeriesInstanceUID: 'series', SOPInstanceUID, ...tags } }),
  });
  const PLANE_TAGS = {
    ImagePositionPatient: [-117.8, -207.8, -373.8], ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    PixelSpacing: [0.39, 0.39], FrameOfReferenceUID: '2.25.7001', Rows: 512, Columns: 512,
  };

  it('answers imagePlaneModule from the instance metadata, below the viewer providers, registered once', () => {
    buildSopInstanceImageIds([{ images: [imaged('planed', PLANE_TAGS)] }]);
    buildSopInstanceImageIds([{ images: [imaged('planed-2', PLANE_TAGS)] }]);
    expect(mockProviders).toHaveLength(1);
    const [{ provider, priority }] = mockProviders;
    expect(priority).toBeLessThan(0);

    expect(provider('imagePlaneModule', 'id:planed')).toMatchObject({
      imagePositionPatient: [-117.8, -207.8, -373.8], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
      rowPixelSpacing: 0.39, columnPixelSpacing: 0.39, frameOfReferenceUID: '2.25.7001', rows: 512, columns: 512,
    });
    expect(provider('instance', 'id:planed')).toBeUndefined();
    expect(provider('imagePlaneModule', 'id:unknown')).toBeUndefined();
  });

  it.each([
    ['empty', []], ['one value', [2]], ['a zero', [0, 2]], ['a negative', [-1, 2]], ['NaN', [NaN, 2]],
    ['an empty string', ['', 2]], ['text', ['a', 2]], ['three values', [1, 1, 1]],
  ])('substitutes no calibration for a pixel spacing with %s', (name, PixelSpacing) => {
    const { fallbackPlaneProvider } = require('./sopInstanceImageIds');
    const sop = `bad-spacing-${name}`;
    buildSopInstanceImageIds([{ images: [imaged(sop, { ...PLANE_TAGS, PixelSpacing })] }]);
    expect(fallbackPlaneProvider('imagePlaneModule', `id:${sop}`)).toBeUndefined();
  });

  it('answers only complete, finite plane geometry; anisotropic spacing and backslash lists are kept as they are', () => {
    const { fallbackPlaneProvider } = require('./sopInstanceImageIds');
    buildSopInstanceImageIds([{ images: [
      imaged('no-position', { ...PLANE_TAGS, ImagePositionPatient: [1, 2] }),
      imaged('nan-orientation', { ...PLANE_TAGS, ImageOrientationPatient: [1, 0, 0, 0, NaN, 0] }),
      imaged('zero-direction', { ...PLANE_TAGS, ImageOrientationPatient: [0, 0, 0, 0, 1, 0] }),
      imaged('anisotropic', { ...PLANE_TAGS, PixelSpacing: [0.5, 2] }),
      imaged('backslash', { ...PLANE_TAGS, PixelSpacing: '0.5\\2', ImagePositionPatient: '1\\2\\3' }),
    ] }]);
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:no-position')).toBeUndefined();
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:nan-orientation')).toBeUndefined();
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:zero-direction')).toBeUndefined();
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:anisotropic')).toMatchObject({ rowPixelSpacing: 0.5, columnPixelSpacing: 2 });
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:backslash')).toMatchObject({
      rowPixelSpacing: 0.5, columnPixelSpacing: 2, imagePositionPatient: [1, 2, 3],
    });
  });

  it('assumes no pixel spacing and no plane, and leaves multiframe instances to the viewer providers', () => {
    const { fallbackPlaneProvider } = require('./sopInstanceImageIds');
    buildSopInstanceImageIds([{ images: [
      imaged('no-spacing', { ...PLANE_TAGS, PixelSpacing: undefined }),
      imaged('no-plane', { PixelSpacing: [1, 1] }),
      imaged('frames', { ...PLANE_TAGS, NumberOfFrames: 2 }),
    ] }]);
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:no-spacing')).toBeUndefined();
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:no-plane')).toBeUndefined();
    expect(fallbackPlaneProvider('imagePlaneModule', 'id:frames:0')).toBeUndefined();
  });
});
