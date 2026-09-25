// Closing the Segmentation Editor on a segmentation created in the viewer (ohif-viewers#143, FR-10)

import commandsModule, { segmentationHasContent } from './commandsModule';
import { callConfirmDialog } from './components/confirmDialog';

const mockDisplaySets = {};
const mockInMemory = {};
const mockLayoutButton = { setIsDisplayedLayoutButton: jest.fn() };

jest.mock('@cornerstonejs/core', () => ({ cache: { getVolume: () => undefined } }), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  Enums: { MouseBindings: {} },
  segmentation: { state: { getSegmentation: () => undefined } },
  utilities: {},
}), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    display: {
      DisplaySetApi: {
        Instance: { displaySetService: { getDisplaySetByUID: uid => mockDisplaySets[uid] } },
      },
    },
  },
}));
jest.mock('@ohif/i18n', () => ({ t: key => key }));
jest.mock('@ohif/extension-vtk', () => ({
  Enums: { CORNERSTONE: {} },
  createViewportToggleFeatureCommand: () => () => {},
  cornerstone3dUtils: {
    getInMemorySegmentationInfo: id => mockInMemory[id],
    getSegmentationVoxels: () => undefined,
  },
}));
jest.mock('@ohif/ui/src/store/useLayoutButton', () => ({
  useLayoutButton: { getState: () => mockLayoutButton },
}));
jest.mock('./components/confirmDialog', () => ({ callConfirmDialog: jest.fn() }));
jest.mock('./utils/setSegmentationEditorLayout.js', () => jest.fn());
jest.mock('./toolbox/segEditorTools', () => ({ LABELMAP_TOOL_NAMES: [] }));

function setup({ inMemory = true } = {}) {
  mockDisplaySets.ds1 = { segmentationId: 'seg::edit' };
  Object.keys(mockInMemory).forEach(key => delete mockInMemory[key]);
  if (inMemory) {
    mockInMemory['seg::edit'] = { segmentationId: 'seg', origin: 'blank' };
  }
  const commandsManager = { runCommand: jest.fn() };
  const servicesManager = { services: { UIDialogService: {} } };
  const { definitions } = commandsModule({ servicesManager, commandsManager });
  const viewports = { activeViewportIndex: 0, viewportSpecificData: { 0: { displaySetInstanceUID: 'ds1' } } };
  return {
    commandsManager,
    // No voxels can be read in this test, which counts as painted
    close: () => definitions.closeSegEditor.commandFn({ viewports }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('segmentationHasContent', () => {
  const volume = voxels => ({ voxelManager: { getCompleteScalarDataArray: () => voxels } });
  const deps = voxels => ({
    getSegmentation: () => ({ representationData: { Labelmap: { volumeId: 'v' } } }),
    getVolume: () => volume(voxels),
    getVoxels: () => undefined,
  });

  it('is true when any voxel holds a segment', () => {
    expect(segmentationHasContent('s', deps(Uint8Array.from([0, 0, 2, 0])))).toBe(true);
    expect(segmentationHasContent('s', deps(new Uint8Array(8)))).toBe(false);
  });

  it('falls back to the stored voxels, and counts unknown as painted', () => {
    expect(segmentationHasContent('s', {
      getSegmentation: () => undefined, getVolume: () => undefined, getVoxels: () => new Uint8Array(4),
    })).toBe(false);
    expect(segmentationHasContent('s', {
      getSegmentation: () => undefined, getVolume: () => undefined, getVoxels: () => undefined,
    })).toBe(true);
  });
});

describe('closeSegEditor', () => {
  it('asks before discarding a new segmentation, and stays open on Cancel', async () => {
    const { commandsManager, close } = setup();
    callConfirmDialog.mockResolvedValue(false);

    expect(await close()).toBe(false);

    expect(callConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Discard Segmentation?', confirmText: 'Discard',
    }));
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
    expect(mockLayoutButton.setIsDisplayedLayoutButton).toHaveBeenCalledWith(false);
  });

  it('closes once the discard is confirmed', async () => {
    const { commandsManager, close } = setup();
    callConfirmDialog.mockResolvedValue(true);

    expect(await close()).toBe(true);
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  });

  it('closes a segmentation loaded from DICOM without asking', async () => {
    const { commandsManager, close } = setup({ inMemory: false });

    expect(await close()).toBe(true);
    expect(callConfirmDialog).not.toHaveBeenCalled();
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  });
});
