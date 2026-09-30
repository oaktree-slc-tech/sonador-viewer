// The Layout widget's command: the preset id lands on the editor's displaySet attribute

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
// The import commands read files and the study; not what these tests exercise
jest.mock('./importers/importCommands.js', () => () => ({ actions: {}, definitions: {} }));
jest.mock('./toolbox/segEditorTools', () => ({ LABELMAP_TOOL_NAMES: [] }));

const viewports = { activeViewportIndex: 0, viewportSpecificData: { 0: { displaySetInstanceUID: 'ds1' } } };

function setup(displaySet) {
  mockDisplaySets.ds1 = displaySet;
  const { definitions } = commandsModule({ servicesManager: { services: {} }, commandsManager: {} });
  return {
    setLayout: layoutId => definitions.setSegEditorLayout.commandFn({ viewports, layoutId }),
    set3DEditing: enabled => definitions.setSegEditor3DEditing.commandFn({ viewports, enabled }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('setSegEditorLayout', () => {
  it('stores a known preset on the displaySet and republishes it', () => {
    const displaySet = { segEditorLayout: 'primary3D' };
    setup(displaySet).setLayout('mpr');

    expect(displaySet.segEditorLayout).toBe('mpr');
    expect(mockAddDisplaySets).toHaveBeenCalledWith([displaySet]);
  });

  it('ignores an unknown preset', () => {
    const displaySet = { segEditorLayout: 'primary3D' };
    setup(displaySet).setLayout('sideways');

    expect(displaySet.segEditorLayout).toBe('primary3D');
    expect(mockAddDisplaySets).not.toHaveBeenCalled();
  });

  it('does not republish an unchanged layout', () => {
    setup({ segEditorLayout: 'mpr' }).setLayout('mpr');
    expect(mockAddDisplaySets).not.toHaveBeenCalled();
  });

  it('acts only once the editor has initialized the attribute', () => {
    const displaySet = {};
    setup(displaySet).setLayout('mpr');

    expect(displaySet.segEditorLayout).toBeUndefined();
    expect(mockAddDisplaySets).not.toHaveBeenCalled();
  });
});

describe('setSegEditor3DEditing', () => {
  it('keeps setting the editing flag through the shared attribute helper', () => {
    const displaySet = { segEditor3dEditingEnabled: false };
    setup(displaySet).set3DEditing(true);

    expect(displaySet.segEditor3dEditingEnabled).toBe(true);
    expect(mockAddDisplaySets).toHaveBeenCalledWith([displaySet]);
  });
});
