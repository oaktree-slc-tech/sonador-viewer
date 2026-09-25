// Starting a segmentation in the viewer (ohif-viewers#143): the in-memory segmentation and the
// Create Segmentation / Open as Segmentation commands.

import { createInMemorySegmentation, hexToRgb } from './createInMemorySegmentation';
import createSegmentationCommands, {
  EDITOR_SEGMENTATION_ATTRIBUTE,
  segmentationLabelFor,
} from './createSegmentationCommands';

const mockIsVolume = jest.fn(() => true);
const mockFindSource = jest.fn();

jest.mock('cornerstone-tools', () => ({ getModule: () => ({ state: { series: {}, colorLutTables: [[]] }, setters: {} }) }));
jest.mock('dcmjs', () => ({ data: { Colors: { dicomlab2RGB: () => [0, 0, 0] } } }));
jest.mock('@ohif/extension-vtk', () => ({ cornerstone3dUtils: {} }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { display: { DisplaySetApi: {} }, utils: { StackManager: {}, studyMetadataManager: {} } },
}));
jest.mock('@ohif/i18n', () => ({
  t: (key, options = {}) => key.replace(/{{(\w+)}}/g, (_m, name) => options[name]),
}));
jest.mock('@ohif/ui', () => ({
  viewerbaseDisplaySetIsCTOrMRVolume: (...args) => mockIsVolume(...args),
  viewerbaseGetDisplaySet: () => ({}),
}), { virtual: true });
jest.mock('@ohif/extension-seg3d-editor', () => ({
  modelsToLabelmap: jest.fn(),
  setSegmentationEditorLayout: jest.fn(),
}), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({
  findM3DSourceDisplaySet: (...args) => mockFindSource(...args),
}), { virtual: true });


const image = imageId => ({ getImageId: () => imageId });
const CT = {
  displaySetInstanceUID: 'ct-ds', StudyInstanceUID: 'study', SeriesInstanceUID: 'ct-series',
  SeriesDescription: 'CT Abdomen', Modality: 'CT', images: [image('ct-1'), image('ct-2')],
};

describe('createInMemorySegmentation', () => {
  function deps() {
    return {
      createCanonicalSegmentation: jest.fn(),
      markInMemorySegmentation: jest.fn(),
      nextLabelmapIndex: jest.fn(() => 2),
      makeColorLUT: jest.fn(() => 5),
    };
  }

  it('registers a canonical segmentation with its segments, and marks it in memory', () => {
    const d = deps();

    const result = createInMemorySegmentation({
      displaySet: CT, label: 'Segmentation – CT Abdomen', origin: 'blank',
      segments: [{ label: 'Segment 1' }], deps: d,
    });

    expect(result).toEqual({ segmentationId: 'ct-1_2', firstImageId: 'ct-1', labelmapIndex: 2 });
    expect(d.nextLabelmapIndex).toHaveBeenCalledWith('ct-1');
    expect(d.createCanonicalSegmentation).toHaveBeenCalledWith(expect.objectContaining({
      segmentationId: 'ct-1_2',
      imageIds: ['ct-1', 'ct-2'],
      labelmapBuffer: undefined,
      firstImageId: 'ct-1',
      labelmapIndex: 2,
      colorLUTIndex: 5,
      layerSegments: [1],
      label: 'Segmentation – CT Abdomen',
      segMetadata: expect.objectContaining({
        data: [undefined, expect.objectContaining({ SegmentNumber: 1, SegmentLabel: 'Segment 1' })],
      }),
    }));
    expect(d.markInMemorySegmentation).toHaveBeenCalledWith('ct-1_2', { origin: 'blank' });
  });

  it('seeds voxels in the buffer\'s own slice order, with segment colours', () => {
    const d = deps();
    const labelmapBuffer = new Uint16Array(4);

    createInMemorySegmentation({
      displaySet: CT, label: 'Knee models', origin: 'models',
      segments: [{ label: 'femur', color: [255, 0, 0] }, { label: 'tibia', color: [0, 255, 0] }],
      labelmapBuffer, bufferImageIds: ['ct-2', 'ct-1'], deps: d,
    });

    const params = d.createCanonicalSegmentation.mock.calls[0][0];
    expect(params.imageIds).toEqual(['ct-2', 'ct-1']);
    expect(params.firstImageId).toBe('ct-1');
    expect(params.labelmapBuffer).toBe(labelmapBuffer);
    expect(params.layerSegments).toEqual([1, 2]);
    expect(d.makeColorLUT.mock.calls[0][0].data[2]).toEqual(expect.objectContaining({
      SegmentLabel: 'tibia', ROIDisplayColor: [0, 255, 0],
    }));
  });

  it('refuses a series without images', () => {
    expect(() => createInMemorySegmentation({
      displaySet: { images: [] }, segments: [], deps: deps(),
    })).toThrow('no images');
  });
});

describe('helpers', () => {
  it('converts panel colours', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('nope')).toBeUndefined();
  });

  it('names a segmentation after its series', () => {
    expect(segmentationLabelFor(CT)).toBe('Segmentation – CT Abdomen');
    expect(segmentationLabelFor({})).toBe('Segmentation');
  });
});

describe('commands', () => {
  function setup() {
    const displaySets = { 'ct-ds': { ...CT }, 'm3d-ds': {
      displaySetInstanceUID: 'm3d-ds', StudyInstanceUID: 'study', SeriesInstanceUID: 'm3d-series',
      SeriesDescription: 'Bone models',
    } };
    const deps = {
      create: jest.fn(() => ({ segmentationId: 'new-seg' })),
      convertModels: jest.fn(async () => ({
        labelmapBuffer: new Uint16Array(4),
        bufferImageIds: ['ct-2', 'ct-1'],
        segments: [{ label: 'femur', color: '#ff0000' }, { label: 'tibia', color: '#00ff00' }],
        overlapVoxels: 0,
        emptySegments: [],
      })),
      openEditor: jest.fn(),
      ensureStack: jest.fn(),
      getDisplaySet: uid => displaySets[uid],
      getStudyDisplaySets: () => Object.values(displaySets),
      findImageSet: (_study, uid) => displaySets[uid],
    };
    const notify = jest.fn();
    const { actions } = createSegmentationCommands({
      servicesManager: { services: { UINotificationService: { show: notify } } }, deps,
    });
    return { actions, deps, notify, displaySets };
  }

  const viewports = {
    activeViewportIndex: 0,
    viewportSpecificData: { 0: { displaySetInstanceUID: 'ct-ds', StudyInstanceUID: 'study' } },
  };

  it('Create Segmentation makes one empty segment and opens the editor on it', () => {
    const { actions, deps, displaySets } = setup();

    expect(actions.createSegmentation({ viewports })).toBe('new-seg');

    expect(deps.ensureStack).toHaveBeenCalledWith(displaySets['ct-ds']);
    expect(deps.create).toHaveBeenCalledWith({
      displaySet: displaySets['ct-ds'],
      label: 'Segmentation – CT Abdomen',
      segments: [{ label: 'Segment 1' }],
      origin: 'blank',
    });
    expect(deps.openEditor).toHaveBeenCalledWith(displaySets['ct-ds'], 'new-seg', {
      viewportData: viewports.viewportSpecificData[0],
    });
  });

  it('Create Segmentation reads the series from the study metadata, not the display set service', () => {
    // After an editor session the service holds the editor's copy of the display set, which has
    // no `images` (non-enumerable on an ImageSet, so lost in every copy)
    const { deps, displaySets } = setup();
    deps.getDisplaySet = () => ({ displaySetInstanceUID: 'ct-ds' });
    const { actions } = createSegmentationCommands({ servicesManager: {}, deps });

    actions.createSegmentation({ viewports });

    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ displaySet: displaySets['ct-ds'] }));
  });

  it('Create Segmentation reports a series whose images cannot be found', () => {
    const { deps } = setup();
    deps.findImageSet = () => undefined;
    const { actions } = createSegmentationCommands({ servicesManager: {}, deps });

    expect(() => actions.createSegmentation({ viewports })).toThrow('no images');
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('Create Segmentation does nothing on a series that is not a CT/MR volume', () => {
    const { actions, deps } = setup();
    mockIsVolume.mockReturnValueOnce(false);

    expect(actions.createSegmentation({ viewports })).toBeUndefined();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('Open as Segmentation converts the models onto the source series and opens the editor', async () => {
    const { actions, deps, displaySets } = setup();
    mockFindSource.mockReturnValue(displaySets['ct-ds']);
    const onProgress = jest.fn();

    expect(await actions.openModelsAsSegmentation({ displaySetInstanceUID: 'm3d-ds', onProgress }))
      .toBe('new-seg');

    expect(deps.convertModels).toHaveBeenCalledWith({
      m3dSeriesInstanceUID: 'm3d-series', imageIds: ['ct-1', 'ct-2'],
    });
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({
      displaySet: displaySets['ct-ds'],
      label: 'Bone models',
      origin: 'models',
      segments: [{ label: 'femur', color: [255, 0, 0] }, { label: 'tibia', color: [0, 255, 0] }],
      bufferImageIds: ['ct-2', 'ct-1'],
    }));
    expect(deps.openEditor).toHaveBeenCalledWith(displaySets['ct-ds'], 'new-seg');
    expect(onProgress.mock.calls.map(([message]) => message))
      .toEqual(['Converting models...', 'Opening the editor...']);
  });

  it('Open as Segmentation reports empty and overlapping models', async () => {
    const { actions, deps, displaySets, notify } = setup();
    mockFindSource.mockReturnValue(displaySets['ct-ds']);
    deps.convertModels.mockResolvedValueOnce({
      labelmapBuffer: new Uint16Array(4), bufferImageIds: [], overlapVoxels: 12,
      segments: [{ label: 'femur' }], emptySegments: [{ segmentIndex: 1, label: 'femur' }],
    });

    await actions.openModelsAsSegmentation({ displaySetInstanceUID: 'm3d-ds' });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', message: expect.stringContaining('femur'),
    }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('Open as Segmentation fails without the source series', async () => {
    const { actions, deps } = setup();
    mockFindSource.mockReturnValue(undefined);

    await expect(actions.openModelsAsSegmentation({ displaySetInstanceUID: 'm3d-ds' }))
      .rejects.toThrow('not in this study');
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('names the segmentation on the service display set, and lays out a viewport copy', () => {
    const { openEditorOnSegmentation } = jest.requireActual('./createSegmentationCommands');
    const open = jest.fn();
    const displaySet = { displaySetInstanceUID: 'ct-ds', plugin: 'cornerstone' };
    const viewportData = { displaySetInstanceUID: 'ct-ds', plugin: 'cornerstone' };

    const serviceDisplaySet = { displaySetInstanceUID: 'ct-ds' };
    openEditorOnSegmentation(displaySet, 'seg-x', {
      open, viewportData, getServiceDisplaySet: () => serviceDisplaySet,
    });

    expect(serviceDisplaySet[EDITOR_SEGMENTATION_ATTRIBUTE]).toBe('seg-x');
    expect(open).toHaveBeenCalledWith(viewportData, [{}]);
    expect(open.mock.calls[0][0]).not.toBe(displaySet);
  });

  it('lays out a copy when no viewport shows the display set (from the models panel)', () => {
    const { openEditorOnSegmentation } = jest.requireActual('./createSegmentationCommands');
    // The layout stamps its plugin on what it is given, as setMultiPanelLayout does
    const open = jest.fn(given => { given.plugin = 'sonador3dseg'; });
    const displaySet = { displaySetInstanceUID: 'ct-ds', plugin: 'cornerstone', images: [] };

    openEditorOnSegmentation(displaySet, 'seg-x', {
      open, viewportData: { displaySetInstanceUID: 'm3d-ds' }, getServiceDisplaySet: () => undefined,
    });

    expect(displaySet.plugin).toBe('cornerstone');
    expect(open.mock.calls[0][0]).toEqual(expect.objectContaining({
      displaySetInstanceUID: 'ct-ds', images: [], [EDITOR_SEGMENTATION_ATTRIBUTE]: 'seg-x',
    }));
  });
});
