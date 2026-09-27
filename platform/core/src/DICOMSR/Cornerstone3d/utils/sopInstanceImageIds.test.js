// SOP instance -> image id map for report hydration, derived the way the viewports derive ids

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
