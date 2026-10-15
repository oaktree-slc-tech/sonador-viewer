// Closing the Segmentation Editor: asking before work is lost, on a segmentation created in the
// viewer (ohif-viewers#143, FR-10) and on the working copy of one loaded from DICOM

import commandsModule, { segmentationHasContent, workingCopyHasChanges } from './commandsModule';
import { callConfirmDialog } from './components/confirmDialog';
import { trackSegEditorHistory } from './toolbox/segEditorHistory';

const mockDisplaySets = {};
const mockInMemory = {};
const mockLayoutButton = { setIsDisplayedLayoutButton: jest.fn() };
// The editor's shared undo history, the segmentation entries and their voxels
const mockHistory = { canUndo: false };
const mockSegmentations = {};
const mockRegistrations = {};

jest.mock('@cornerstonejs/core', () => ({
  cache: { getVolume: () => undefined },
  utilities: { HistoryMemo: { get DefaultHistoryMemo() { return mockHistory; } } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  Enums: { MouseBindings: {} },
  segmentation: { state: { getSegmentation: id => mockSegmentations[id] } },
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
    getLabelmapRegistration: id => mockRegistrations[id],
    getSegmentationVoxels: id => mockRegistrations[id]?.scalarData,
  },
}));
jest.mock('@ohif/ui/src/store/useLayoutButton', () => ({
  useLayoutButton: { getState: () => mockLayoutButton },
}));
jest.mock('./components/confirmDialog', () => ({ callConfirmDialog: jest.fn() }));
// The pinned library's HistoryMemo is loaded from its own file in the ring-overflow case
jest.mock('../../../node_modules/@cornerstonejs/core/dist/esm/eventTarget', () => ({
  __esModule: true, default: { dispatchEvent: () => true },
}));
jest.mock('./utils/setSegmentationEditorLayout.js', () => jest.fn());
// The import commands read files and the study; not what these tests exercise
jest.mock('./importers/importCommands.js', () => () => ({ actions: {}, definitions: {} }));
jest.mock('./toolbox/segEditorTools', () => ({ LABELMAP_TOOL_NAMES: [] }));

const SEGMENTS = { 1: { segmentIndex: 1, label: 'Liver' }, 2: { segmentIndex: 2, label: 'Tumor' } };

function clear(record) {
  Object.keys(record).forEach(key => delete record[key]);
}

/** A segmentation loaded from DICOM ('seg') and the editor's working copy of it ('seg::edit'). */
function loadedFromDicom({ voxels = [0, 1, 2, 0], segments = SEGMENTS } = {}) {
  mockSegmentations.seg = { segmentationId: 'seg', segments: SEGMENTS };
  mockSegmentations['seg::edit'] = { segmentationId: 'seg::edit', segments: JSON.parse(JSON.stringify(segments)) };
  mockRegistrations.seg = { scalarData: Uint8Array.from([0, 1, 2, 0]) };
  mockRegistrations['seg::edit'] = { workingCopyOf: 'seg', scalarData: Uint8Array.from(voxels) };
}

function setup({ inMemory = true } = {}) {
  mockDisplaySets.ds1 = { segmentationId: 'seg::edit' };
  clear(mockInMemory);
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
  mockHistory.canUndo = false;
  clear(mockSegmentations);
  clear(mockRegistrations);
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

describe('workingCopyHasChanges', () => {
  it('is false for a working copy that still matches its source', () => {
    loadedFromDicom();
    expect(workingCopyHasChanges('seg::edit')).toBe(false);
  });

  it('is true while an edit is in the undo history, and false once every edit is undone', () => {
    loadedFromDicom();
    mockHistory.canUndo = true;
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
    mockHistory.canUndo = false;
    expect(workingCopyHasChanges('seg::edit')).toBe(false);
  });

  it('is true when a voxel differs from the source (an import, an edit the history dropped)', () => {
    loadedFromDicom({ voxels: [0, 1, 1, 0] });
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
  });

  it('is true when a segment was added, removed or renamed', () => {
    loadedFromDicom({ segments: { ...SEGMENTS, 3: { segmentIndex: 3, label: 'Vessel' } } });
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
    loadedFromDicom({ segments: { 1: SEGMENTS[1] } });
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
    loadedFromDicom({ segments: { ...SEGMENTS, 2: { segmentIndex: 2, label: 'Lesion' } } });
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
  });

  it('is true for a surface-only edit (a Repair) the history ring dropped, after every later edit is undone', () => {
    // The review's case (!102 round 4), with the pinned library's HistoryMemo and a ring of 3:
    // Repair changes the surface only, so the voxels and segments still match the source
    const { HistoryMemo } = require('../../../node_modules/@cornerstonejs/core/dist/esm/utilities/historyMemo/index.js');
    const history = new HistoryMemo('test', 3);
    const untrack = trackSegEditorHistory(history);
    const surface = { repaired: false, smoothed: 0 };
    surface.repaired = true;
    history.push({ restoreMemo: isUndo => { surface.repaired = !isUndo; } });
    [1, 2, 3].forEach(() => {
      surface.smoothed += 1;
      history.push({ restoreMemo: isUndo => { surface.smoothed += isUndo ? -1 : 1; } });
    });
    while (history.canUndo) {
      history.undo();
    }
    loadedFromDicom();

    expect(surface).toEqual({ repaired: true, smoothed: 0 });
    expect(workingCopyHasChanges('seg::edit', { history })).toBe(true);
    untrack();

    // Without a dropped edit, undoing everything is clean (Repair, then Undo)
    const clean = new HistoryMemo('test', 3);
    const untrackClean = trackSegEditorHistory(clean);
    clean.push({ restoreMemo: () => {} });
    clean.undo();
    expect(workingCopyHasChanges('seg::edit', { history: clean })).toBe(false);
    untrackClean();
  });

  it('counts unknown as modified', () => {
    loadedFromDicom();
    delete mockRegistrations.seg;
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
    clear(mockRegistrations);
    expect(workingCopyHasChanges('seg::edit')).toBe(true);
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

  it('closes an unchanged segmentation loaded from DICOM without asking', async () => {
    loadedFromDicom();
    const { commandsManager, close } = setup({ inMemory: false });

    expect(await close()).toBe(true);
    expect(callConfirmDialog).not.toHaveBeenCalled();
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  });

  it('asks before discarding the changes to a segmentation loaded from DICOM, and stays open on Cancel', async () => {
    loadedFromDicom();
    mockHistory.canUndo = true;
    const { commandsManager, close } = setup({ inMemory: false });
    callConfirmDialog.mockResolvedValue(false);

    expect(await close()).toBe(false);

    expect(callConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      id: 'seg-editor-discard-confirm', title: 'Discard Changes?', confirmText: 'Discard', cancelText: 'Cancel',
    }));
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
    expect(mockLayoutButton.setIsDisplayedLayoutButton).toHaveBeenCalledWith(false);

    callConfirmDialog.mockResolvedValue(true);
    expect(await close()).toBe(true);
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setCornerstoneLayout');
  });
});
