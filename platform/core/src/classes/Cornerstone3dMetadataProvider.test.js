// Cornerstone3D metadata resolution for offline (`sonadorlocal:`) imageIds.
//
// The provider is keyed by `imageIdToURI(imageId)` and its own id parsing only understands wadors
// and `?requestType=WADO` urls, so an offline id resolves only if `StackManager.createAndAddStack`
// registered it. These tests go through StackManager rather than calling `addImageIdToUIDs`
// directly, because the registration site is the requirement.

// @cornerstonejs/core ships ESM only and is not transformed for this node test environment. The
// provider uses exactly two things from it, both replaced here.
jest.mock('@cornerstonejs/core', () => ({
  utilities: {
    calibratedPixelSpacingMetadataProvider: { add: () => {} },
    getPixelSpacingInformation: instance => ({ PixelSpacing: instance.PixelSpacing, type: null }),
  },
}));

import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
import DicomMetadataStore from '../services/DicomMetadataStore';
import StackManager from '../utils/StackManager';
import c3dMetadataProvider from './Cornerstone3dMetadataProvider';

// Node test environment: shim the DOM mirror inside PubSubService._broadcastEvent (see
// LocalCacheService.test.js for the rationale).
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

const StudyInstanceUID = '1.2.840.113619.2.1';
const SINGLE_FRAME_SOP = '1.2.840.113619.2.1.100';
const MULTI_FRAME_SOP = '1.2.840.113619.2.1.200';

function makeInstance(overrides) {
  return {
    StudyInstanceUID,
    SeriesInstanceUID: '1.2.840.113619.2.1.9',
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    Modality: 'CT',
    Rows: 512,
    Columns: 512,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 1,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    PixelSpacing: ['0.7', '0.7'],
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    ImagePositionPatient: [0, 0, 0],
    SliceThickness: '1.0',
    ...overrides,
  };
}

// The shape StackManager consumes: displaySet.images[n].getData() -> the "image" object, whose
// `metadata` is the naturalized instance.
function makeDisplaySetImage(naturalizedInstance) {
  const image = {
    metadata: naturalizedInstance,
    SOPInstanceUID: naturalizedInstance.SOPInstanceUID,
    // getImageId() builds `dicomweb:<wadouri>` from this, which is what makes the id a candidate
    // for the offline swap.
    wadouri: `https://example.invalid/wado?objectUID=${naturalizedInstance.SOPInstanceUID}`,
  };

  return { getData: () => image };
}

describe('Cornerstone3dMetadataProvider + StackManager registration', () => {
  beforeAll(() => {
    const singleFrame = makeInstance({
      SOPInstanceUID: SINGLE_FRAME_SOP,
      WindowCenter: '40',
      WindowWidth: '400',
    });

    const multiFrame = makeInstance({
      SOPInstanceUID: MULTI_FRAME_SOP,
      NumberOfFrames: 5,
      // Multiframe position comes from the per-frame functional groups, not the root.
      ImagePositionPatient: undefined,
      SharedFunctionalGroupsSequence: [{}],
      PerFrameFunctionalGroupsSequence: [
        { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 0] }] },
        { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 1] }] },
        { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 2] }] },
        { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 3] }] },
        { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 4] }] },
      ],
    });

    DicomMetadataStore.addInstances([singleFrame, multiFrame]);

    // Every instance in this study is offline-cached, so getImageId() returns `sonadorlocal:` ids.
    jest.spyOn(LocalCacheService, 'isInstanceCachedSync').mockReturnValue(true);

    StackManager.makeAndAddStack(
      { StudyInstanceUID },
      {
        displaySetInstanceUID: 'display-set-1',
        images: [makeDisplaySetImage(singleFrame), makeDisplaySetImage(multiFrame)],
      }
    );
  });

  afterAll(() => {
    jest.restoreAllMocks();
    StackManager.clearStacks();
  });

  it('builds the stack from sonadorlocal: imageIds', () => {
    const { imageIds } = StackManager.findStack('display-set-1');

    expect(imageIds[0]).toBe(`sonadorlocal:${SINGLE_FRAME_SOP}`);
    // Multiframe ids carry the frame as `?frame=`, not `&frame=`.
    expect(imageIds[1]).toBe(`sonadorlocal:${MULTI_FRAME_SOP}?frame=0`);
    expect(imageIds).toHaveLength(6);
  });

  it('resolves `instance` and `imagePlaneModule` for a single-frame sonadorlocal: id', () => {
    const imageId = `sonadorlocal:${SINGLE_FRAME_SOP}`;

    const instance = c3dMetadataProvider.get('instance', imageId);
    expect(instance).toBeDefined();
    expect(instance.SOPInstanceUID).toBe(SINGLE_FRAME_SOP);

    const imagePlaneModule = c3dMetadataProvider.get('imagePlaneModule', imageId);
    expect(imagePlaneModule.rows).toBe(512);
    expect(imagePlaneModule.columns).toBe(512);
    expect(imagePlaneModule.rowPixelSpacing).toBe('0.7');
    expect(imagePlaneModule.usingDefaultValues).toBe(false);
  });

  it('resolves the other modules a Cornerstone3D viewport asks for', () => {
    const imageId = `sonadorlocal:${SINGLE_FRAME_SOP}`;

    expect(c3dMetadataProvider.get('imagePixelModule', imageId)).toMatchObject({
      rows: 512,
      columns: 512,
      bitsAllocated: 16,
      pixelRepresentation: 1,
    });
    expect(c3dMetadataProvider.get('generalSeriesModule', imageId)).toMatchObject({
      modality: 'CT',
    });
    expect(c3dMetadataProvider.get('voiLutModule', imageId)).toMatchObject({
      windowCenter: [40],
      windowWidth: [400],
    });
    expect(c3dMetadataProvider.get('sopCommonModule', imageId)).toMatchObject({
      sopInstanceUID: SINGLE_FRAME_SOP,
    });
  });

  it('resolves the frame-specific imagePlaneModule for a multiframe sonadorlocal: id', () => {
    // `?frame=3` is the fourth frame; DICOM frame numbers are one-based, and the registered
    // frameIndex is zero-based, matching the equivalent wadors `/frames/4` id.
    const instance = c3dMetadataProvider.get('instance', `sonadorlocal:${MULTI_FRAME_SOP}?frame=3`);

    expect(instance).toBeDefined();
    expect(instance.frameNumber).toBe(4);
    expect(instance.ImagePositionPatient).toEqual([0, 0, 3]);

    const firstFrame = c3dMetadataProvider.get(
      'instance',
      `sonadorlocal:${MULTI_FRAME_SOP}?frame=0`
    );
    expect(firstFrame.frameNumber).toBe(1);
    expect(firstFrame.ImagePositionPatient).toEqual([0, 0, 0]);
  });

  it('leaves resolution of a remote wadouri id unchanged', () => {
    // Same registration call, remote id shape: nothing about the existing path moves.
    const remoteInstance = makeInstance({ SOPInstanceUID: '1.2.840.113619.2.1.300' });
    DicomMetadataStore.addInstances([remoteInstance]);

    const remoteImageId = 'dicomweb:https://example.invalid/wado?objectUID=1.2.840.113619.2.1.300';
    c3dMetadataProvider.addImageIdToUIDs(remoteImageId, {
      StudyInstanceUID,
      SeriesInstanceUID: remoteInstance.SeriesInstanceUID,
      SOPInstanceUID: remoteInstance.SOPInstanceUID,
    });

    const uids = c3dMetadataProvider.getUIDsFromImageID(remoteImageId);
    expect(uids.SOPInstanceUID).toBe('1.2.840.113619.2.1.300');
    expect(uids.frameNumber).toBe('1');
    expect(c3dMetadataProvider.get('imagePlaneModule', remoteImageId).rows).toBe(512);
  });

  it('returns undefined rather than throwing when there is no imageId', () => {
    // Cornerstone3D's metaData.get walks providers and takes the first non-undefined result; it
    // does NOT catch. A provider that throws aborts the whole lookup for every consumer, which is
    // what stopped SR tool-state generation ("Unable to generate tool state for ...") when
    // MeasurementReport asked for metadata with no imageId.
    [undefined, null, ''].forEach(imageId => {
      expect(() => c3dMetadataProvider.get('imagePlaneModule', imageId)).not.toThrow();
      expect(c3dMetadataProvider.get('imagePlaneModule', imageId)).toBeUndefined();
      expect(c3dMetadataProvider.get('instance', imageId)).toBeUndefined();
    });
  });

  it('does not stop a lower-priority provider from answering', () => {
    // Stand in for metaData.get's loop: ours must yield, not blow up the iteration.
    const fallback = jest.fn(() => ({ rows: 64 }));
    const providers = [
      (type, imageId) => c3dMetadataProvider.get(type, imageId),
      fallback,
    ];

    let result;
    expect(() => {
      for (const provider of providers) {
        result = provider('imagePlaneModule', undefined);
        if (result !== undefined) {
          break;
        }
      }
    }).not.toThrow();

    expect(fallback).toHaveBeenCalled();
    expect(result).toEqual({ rows: 64 });
  });

  it('still rejects an empty imageId at registration time', () => {
    // Writing junk into the map is a programmer error and stays loud; only reads are forgiving.
    expect(() => c3dMetadataProvider.addImageIdToUIDs(undefined, {})).toThrow('Empty imageId');
  });

  it('returns undefined for a sonadorlocal: id that was never registered', () => {
    const imageId = 'sonadorlocal:9.9.9.9.never-registered';

    expect(c3dMetadataProvider.getUIDsFromImageID(imageId)).toBeUndefined();
    expect(c3dMetadataProvider.get('instance', imageId)).toBeUndefined();
    expect(c3dMetadataProvider.get('imagePlaneModule', imageId)).toBeUndefined();
  });
});
