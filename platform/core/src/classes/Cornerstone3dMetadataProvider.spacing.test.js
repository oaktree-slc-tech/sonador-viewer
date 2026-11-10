// How the viewer's metadata provider reports pixel spacing at the pinned Cornerstone3D, and how the
// Segmentation Editor's unit resolver reads it (ohif-viewers#151, integration item 5).
//
// The viewer registers Cornerstone3dMetadataProvider at priority 9999 (extensions/cornerstone
// initDataIntegrations), so it answers for every image the DicomMetadataStore knows, ahead of the
// loader's wadors / wadouri providers. Its `imagePlaneModule` takes the spacing from the core's
// `getPixelSpacingInformation`, which this test runs for real at the pin (@cornerstonejs/core
// 4.22.13; the enums import of the helper is replaced, since the rest of the enums pull in vtk.js).
// The resolver is extensions/seg-editor's `unitsOfImages`, run against the provider's `get`.
//
// The cases are the ones the issue names: instance metadata absent; a valid spacing reported with
// the aggregate `usingDefaultValues` raised for another reason; enhanced shared / per-frame Pixel
// Measures; malformed values; and a projection image whose only spacing is the detector's.

jest.mock('@cornerstonejs/core', () => ({
  utilities: {
    calibratedPixelSpacingMetadataProvider: { add: () => {} },
    getPixelSpacingInformation: jest.requireActual('../../../../node_modules/@cornerstonejs/core/dist/esm/utilities/getPixelSpacingInformation.js').default,
  },
  // What the resolver imports; unused here (it is given the provider's `get`)
  cache: {},
  metaData: {},
}));
// The helper's one import from the enums (the values at 4.22.13; the package's exports map hides
// the subpath, so the files are reached by their paths)
jest.mock('../../../../node_modules/@cornerstonejs/core/dist/esm/enums/index.js', () => ({
  CalibrationTypes: {
    NOT_APPLICABLE: '',
    ERMF: 'ERMF',
    USER: 'User',
    PROJECTION: 'Proj',
    REGION: 'Region',
    ERROR: 'Error',
    UNCALIBRATED: 'Uncalibrated',
    CALIBRATED: 'Calibrated',
    UNKNOWN: 'Unknown',
  },
}));
jest.mock('@cornerstonejs/tools', () => ({ ToolGroupManager: {} }), { virtual: true });

import {
  CALIBRATION,
  SPACING_SOURCE,
  unitsOfImages,
  UNKNOWN_REASON,
} from '../../../../extensions/seg-editor/src/utils/segEditorUnits';
import DicomMetadataStore from '../services/DicomMetadataStore';
import LocalCacheService from '../services/LocalCacheService/LocalCacheService';
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

const StudyInstanceUID = '1.2.826.0.1.3680043.8.498.1';
const SeriesInstanceUID = `${StudyInstanceUID}.2`;
const CT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.2';
const ENHANCED_CT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.2.1';
const DX_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.1.1';

const SOP = {
  calibrated: `${SeriesInstanceUID}.1`,
  noSpacing: `${SeriesInstanceUID}.2`,
  spacingNoPosition: `${SeriesInstanceUID}.3`,
  enhancedShared: `${SeriesInstanceUID}.4`,
  enhancedPerFrame: `${SeriesInstanceUID}.5`,
  malformed: `${SeriesInstanceUID}.6`,
  detectorOnly: `${SeriesInstanceUID}.7`,
  radiographCalibrated: `${SeriesInstanceUID}.8`,
};

function makeInstance(overrides) {
  return {
    StudyInstanceUID,
    SeriesInstanceUID,
    SOPClassUID: CT_SOP_CLASS,
    Modality: 'CT',
    Rows: 64,
    Columns: 64,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 1,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    ImagePositionPatient: [0, 0, 0],
    SliceThickness: '1.0',
    ...overrides,
  };
}

function makeDisplaySetImage(instance) {
  const image = {
    metadata: instance,
    SOPInstanceUID: instance.SOPInstanceUID,
    wadouri: `https://example.invalid/wado?objectUID=${instance.SOPInstanceUID}`,
  };
  return { getData: () => image };
}

const get = (type, imageId) => c3dMetadataProvider.get(type, imageId);
const imageIdOf = (sop, frame) => `sonadorlocal:${sop}${frame === undefined ? '' : `?frame=${frame}`}`;
const resolve = imageId => unitsOfImages([imageId], get);

describe('Cornerstone3dMetadataProvider pixel spacing at the pinned Cornerstone3D, as the editor reads it', () => {
  beforeAll(() => {
    const enhancedFrames = [
      { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 0] }] },
      { PlanePositionSequence: [{ ImagePositionPatient: [0, 0, 1] }] },
    ];
    const instances = [
      makeInstance({ SOPInstanceUID: SOP.calibrated, PixelSpacing: ['0.7', '0.7'] }),
      makeInstance({ SOPInstanceUID: SOP.noSpacing }),
      makeInstance({ SOPInstanceUID: SOP.spacingNoPosition, PixelSpacing: ['0.7', '0.7'], ImagePositionPatient: undefined }),
      makeInstance({
        SOPInstanceUID: SOP.enhancedShared,
        SOPClassUID: ENHANCED_CT_SOP_CLASS,
        NumberOfFrames: 2,
        ImagePositionPatient: undefined,
        SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: ['0.8', '0.8'], SliceThickness: '1' }] }],
        PerFrameFunctionalGroupsSequence: enhancedFrames,
      }),
      makeInstance({
        SOPInstanceUID: SOP.enhancedPerFrame,
        SOPClassUID: ENHANCED_CT_SOP_CLASS,
        NumberOfFrames: 2,
        ImagePositionPatient: undefined,
        SharedFunctionalGroupsSequence: [{}],
        PerFrameFunctionalGroupsSequence: enhancedFrames.map(frame => ({
          ...frame, PixelMeasuresSequence: [{ PixelSpacing: ['0.9', '0.9'], SliceThickness: '1' }],
        })),
      }),
      makeInstance({ SOPInstanceUID: SOP.malformed, PixelSpacing: ['0.5', 'abc'] }),
      makeInstance({
        SOPInstanceUID: SOP.detectorOnly,
        SOPClassUID: DX_SOP_CLASS,
        Modality: 'DX',
        ImagerPixelSpacing: ['0.14', '0.14'],
      }),
      makeInstance({
        SOPInstanceUID: SOP.radiographCalibrated,
        SOPClassUID: DX_SOP_CLASS,
        Modality: 'DX',
        PixelSpacing: ['0.2', '0.2'],
        ImagerPixelSpacing: ['0.14', '0.14'],
        PixelSpacingCalibrationType: 'FIDUCIAL',
      }),
    ];
    DicomMetadataStore.addInstances(instances);
    jest.spyOn(LocalCacheService, 'isInstanceCachedSync').mockReturnValue(true);
    StackManager.makeAndAddStack(
      { StudyInstanceUID },
      { displaySetInstanceUID: 'units-display-set', images: instances.map(makeDisplaySetImage) }
    );
  });

  afterAll(() => {
    jest.restoreAllMocks();
    StackManager.clearStacks();
  });

  it('reports a Pixel Spacing as the plane spacing with nothing defaulted; the editor reads millimetres', () => {
    const imageId = imageIdOf(SOP.calibrated);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.7', columnPixelSpacing: '0.7', usingDefaultValues: false });
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.mm, source: SPACING_SOURCE.pixelSpacing, planeSpacing: [0.7, 0.7], intensity: 'HU' });
  });

  it('synthesizes a spacing of 1 and raises the flag when Pixel Spacing is missing; the editor reads unknown', () => {
    const imageId = imageIdOf(SOP.noSpacing);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: 1, columnPixelSpacing: 1, usingDefaultValues: true });
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.noSpacing });
  });

  it('raises the flag for a missing position while keeping a real spacing; the editor still reads millimetres', () => {
    // The aggregate flag cannot tell a synthesized spacing from a defaulted position, which is why
    // the resolver reads the instance's attributes rather than the flag
    const imageId = imageIdOf(SOP.spacingNoPosition);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.7', usingDefaultValues: true });
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.mm, source: SPACING_SOURCE.pixelSpacing });
  });

  it('reads an enhanced object\'s shared Pixel Measures per frame; the editor reads millimetres', () => {
    const imageId = imageIdOf(SOP.enhancedShared, 1);
    const instance = get('instance', imageId);
    expect(instance.frameNumber).toBe(2);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.8', columnPixelSpacing: '0.8', usingDefaultValues: false });
    const units = resolve(imageId);
    expect(units.calibration).toBe(CALIBRATION.mm);
    expect(units.planeSpacing).toEqual([0.8, 0.8]);
    // The viewer's combineFrameInstance lifts the functional groups to the instance root, so the
    // resolver sees the measures as a root Pixel Spacing or as the group, whichever survived
    expect([SPACING_SOURCE.pixelSpacing, SPACING_SOURCE.pixelMeasures]).toContain(units.source);
  });

  it('reads an enhanced object\'s per-frame Pixel Measures; the editor reads millimetres', () => {
    const imageId = imageIdOf(SOP.enhancedPerFrame, 0);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.9', usingDefaultValues: false });
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.mm, planeSpacing: [0.9, 0.9] });
  });

  it('passes a malformed Pixel Spacing through with nothing defaulted; the editor refuses it', () => {
    // The plane module reports the malformed pair as a spacing: a consumer trusting it would take
    // 'abc' for a length. The resolver reads the instance and says why it is unknown.
    const imageId = imageIdOf(SOP.malformed);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.5', columnPixelSpacing: 'abc', usingDefaultValues: false });
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.invalid });
  });

  it('substitutes the detector spacing on a radiograph with nothing defaulted; the editor keeps it apart', () => {
    // getPixelSpacingInformation on a projection SOP class with Imager Pixel Spacing only: the
    // plane module reports 0.14 as the spacing, type Projection, flag down
    const imageId = imageIdOf(SOP.detectorOnly);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.14', columnPixelSpacing: '0.14', usingDefaultValues: false });
    expect(resolve(imageId)).toMatchObject({
      calibration: CALIBRATION.unknown,
      reason: UNKNOWN_REASON.detectorOnly,
      planeSpacing: null,
      detectorSpacing: [0.14, 0.14],
      intensity: null,
    });
  });

  it('keeps a calibrated radiograph\'s Pixel Spacing; the editor reads millimetres and records the detector spacing', () => {
    const imageId = imageIdOf(SOP.radiographCalibrated);
    expect(get('imagePlaneModule', imageId)).toMatchObject({ rowPixelSpacing: '0.2', usingDefaultValues: false });
    expect(resolve(imageId)).toMatchObject({
      calibration: CALIBRATION.mm,
      source: SPACING_SOURCE.pixelSpacing,
      planeSpacing: [0.2, 0.2],
      detectorSpacing: [0.14, 0.14],
    });
  });

  it('answers nothing for an image it does not know; the editor reads unknown for want of metadata', () => {
    const imageId = `sonadorlocal:${SeriesInstanceUID}.999`;
    expect(get('instance', imageId)).toBeUndefined();
    expect(get('imagePlaneModule', imageId)).toBeUndefined();
    expect(resolve(imageId)).toMatchObject({ calibration: CALIBRATION.unknown, reason: UNKNOWN_REASON.noMetadata });
  });
});
