// The 3D menu's Reset: rendering toggles back to their defaults and a camera-reset request, in
// one publish, leaving everything else on the displaySet alone

import commandsModule from './commandsModule';

const mockDisplaySets = {};
const mockAddDisplaySets = jest.fn();

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
        Instance: {
          displaySetService: {
            getDisplaySetByUID: uid => mockDisplaySets[uid],
            addDisplaySets: (...args) => mockAddDisplaySets(...args),
          },
        },
      },
    },
  },
}));
jest.mock('@ohif/i18n', () => ({ t: key => key }));
jest.mock('@ohif/extension-vtk', () => ({
  Enums: { CORNERSTONE: { AXIAL: 'Axial', CORONAL: 'Coronal', SAGITTAL: 'Sagittal', C3D_3D: '3D' } },
  createViewportToggleFeatureCommand: () => () => {},
  cornerstone3dUtils: {},
}));
jest.mock('@ohif/ui/src/store/useLayoutButton', () => ({ useLayoutButton: { getState: () => ({}) } }));
jest.mock('./components/confirmDialog', () => ({ callConfirmDialog: jest.fn() }));
jest.mock('./utils/setSegmentationEditorLayout.js', () => jest.fn());
jest.mock('./toolbox/segEditorTools', () => ({ LABELMAP_TOOL_NAMES: [] }));

const viewports = { activeViewportIndex: 0, viewportSpecificData: { 0: { displaySetInstanceUID: 'ds1' } } };

function reset(displaySet) {
  mockDisplaySets.ds1 = displaySet;
  const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: {} });
  definitions.resetSegEditor3DView.commandFn({ viewports });
  return displaySet;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resetSegEditor3DView', () => {
  it('returns the rendering toggles to their defaults and requests a camera reset, once', () => {
    const displaySet = reset({
      segEditorVolumeRenderingEnabled: true,
      segEditorSurfaceRenderingEnabled: false,
      segEditor3dViewReset: 0,
      segEditorLayout: 'mpr',
      segEditor3dEditingEnabled: true,
      segmentationId: 'seg::edit',
    });

    expect(displaySet).toMatchObject({
      segEditorVolumeRenderingEnabled: false,
      segEditorSurfaceRenderingEnabled: true,
      segEditor3dViewReset: 1,
      // untouched: layout, editing mode, the segmentation
      segEditorLayout: 'mpr',
      segEditor3dEditingEnabled: true,
      segmentationId: 'seg::edit',
    });
    expect(mockAddDisplaySets).toHaveBeenCalledTimes(1);
    expect(mockAddDisplaySets).toHaveBeenCalledWith([displaySet]);
  });

  it('still requests the camera reset when the toggles are already at their defaults', () => {
    const displaySet = reset({
      segEditorVolumeRenderingEnabled: false,
      segEditorSurfaceRenderingEnabled: true,
      segEditor3dViewReset: 3,
    });

    expect(displaySet.segEditor3dViewReset).toBe(4);
    expect(mockAddDisplaySets).toHaveBeenCalledTimes(1);
  });

  it('does nothing before the editor has initialized the attributes', () => {
    const displaySet = reset({ segmentationId: 'seg::edit' });

    expect(displaySet).toEqual({ segmentationId: 'seg::edit' });
    expect(mockAddDisplaySets).not.toHaveBeenCalled();
  });
});
