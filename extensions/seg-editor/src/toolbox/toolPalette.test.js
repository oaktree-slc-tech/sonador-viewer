// Segmentation Editor tool palettes (ohif-viewers#142): tool context, evaluators, commands, and the
// palette wired end to end through the ToolbarService and CommandsManager.

import SonadorToolbarService from '@ohif/core/src/services/ToolBarService/SonadorToolbarService';
import CommandsManager from '@ohif/core/src/classes/CommandsManager';
import { buildButtonCommands } from '@ohif/core/src/utils/buildButtonCommands';

import commandsModule from '../commandsModule';
import getSegEditorEvaluators from './evaluators';
import { registerSegEditorToolbar } from './registerSegEditorToolbar';
import { addLabelmapTools } from './segEditorTools';
import {
  clearSegEditorToolContext,
  getSegEditorToolContext,
  setSegEditorToolContext,
  subscribeSegEditorToolContext,
} from './segEditorToolContext';
import { EVALUATORS, POINTER_BUTTONS, SECTIONS, SEG_EDITOR_COMMAND_CONTEXT } from './constants';
import {
  get3DToolState,
  handle3DToolRequest,
  reset3DToolState,
  set3DToolBusy,
  set3DSelectionCount,
  set3DToolTarget,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';
import { setSegEditorActiveViewport } from './segEditorToolContext';

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/tools', () => require('./testing/cornerstoneToolsMock'), { virtual: true });
const mockCore = {
  viewports: {},
  scroll: jest.fn(),
  history: { canUndo: false, canRedo: false, undo: jest.fn(), redo: jest.fn() },
};
jest.mock('@cornerstonejs/core', () => {
  class VolumeViewport {
    getVolumeId() {
      return 'volume';
    }
  }
  return {
    eventTarget: { addEventListener: jest.fn() },
    VolumeViewport,
    getEnabledElementByViewportId: id => (mockCore.viewports[id] ? { viewport: mockCore.viewports[id] } : undefined),
    utilities: {
      scroll: (...args) => mockCore.scroll(...args),
      HistoryMemo: { get DefaultHistoryMemo() { return mockCore.history; } },
    },
  };
}, { virtual: true });
jest.mock('@ohif/i18n', () => ({ t: key => key.split(':').pop() }));
jest.mock('@ohif/extension-vtk', () => ({
  Enums: { CORNERSTONE: {} },
  createViewportToggleFeatureCommand: () => () => {},
}));
jest.mock('../utils/setSegmentationEditorLayout.js', () => jest.fn());
jest.mock('../components/confirmDialog', () => ({ callConfirmDialog: jest.fn() }));
jest.mock('@ohif/ui/src/store/useLayoutButton', () => ({
  useLayoutButton: { getState: () => ({ setIsDisplayedLayoutButton: jest.fn() }) },
}));
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { display: { DisplaySetApi: { Instance: { displaySetService: {} } } } },
}));

// Node test environment: PubSubService._broadcastEvent also dispatches a CustomEvent
if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent {
    constructor(type, params = {}) {
      this.type = type;
      this.detail = params.detail;
    }
  };
}
if (typeof global.document === 'undefined') {
  global.document = { body: { dispatchEvent: () => true } };
}

const cstMock = require('./testing/cornerstoneToolsMock');
const { MouseBindings } = cstMock.Enums;

const TOOL_GROUP_ID = 'sonadorSegViewer';
const VIEWPORT_IDS = ['seg-Axial', 'seg-Coronal', 'seg-Sagittal'];
const SEGMENTATION_ID = 'source-seg::edit';

// The editor's 2D tool group as initTools leaves it: imaging tools bound, labelmap tools passive
function createEditorToolGroup() {
  const toolGroup = cstMock.__testing.createToolGroup(TOOL_GROUP_ID);
  ['WindowLevel', 'Zoom', 'Pan', 'StackScroll'].forEach(name => toolGroup.addTool(name));
  addLabelmapTools(toolGroup);
  toolGroup.setToolActive('WindowLevel', { bindings: [{ mouseButton: MouseBindings.Primary }] });
  toolGroup.setToolActive('Zoom', { bindings: [{ mouseButton: MouseBindings.Secondary }] });
  toolGroup.setToolActive('Pan', { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  toolGroup.setToolActive('StackScroll', { bindings: [{ mouseButton: MouseBindings.Wheel }] });
  return toolGroup;
}

function publishEditor({ segments = { 1: {} } } = {}) {
  cstMock.__testing.segmentations[SEGMENTATION_ID] = { segmentationId: SEGMENTATION_ID, segments };
  setSegEditorToolContext({
    toolGroupId: TOOL_GROUP_ID,
    viewportIds: VIEWPORT_IDS,
    segmentationId: SEGMENTATION_ID,
  });
}

function createCommands(toolbarService = { refreshToolbarState: jest.fn() }) {
  const servicesManager = { services: { toolbarService } };
  const commandsManager = new CommandsManager({
    getAppState: () => ({ viewports: {} }),
    getActiveContexts: () => ['VIEWER', SEG_EDITOR_COMMAND_CONTEXT],
  });
  commandsManager.createContext(SEG_EDITOR_COMMAND_CONTEXT);

  const { definitions } = commandsModule({ servicesManager, commandsManager });
  Object.entries(definitions).forEach(([name, definition]) =>
    commandsManager.registerCommand(SEG_EDITOR_COMMAND_CONTEXT, name, definition)
  );

  const run = (name, options = {}) =>
    commandsManager.runCommand(name, options, SEG_EDITOR_COMMAND_CONTEXT);

  return { commandsManager, servicesManager, run };
}

beforeEach(() => {
  clearSegEditorToolContext();
  reset3DToolState({ settings: true });
  cstMock.__testing.reset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  console.warn.mockRestore();
});


describe('segEditorToolContext', () => {
  it('publishes, resolves and clears the editor context', () => {
    const toolGroup = createEditorToolGroup();
    const listener = jest.fn();
    const unsubscribe = subscribeSegEditorToolContext(listener);

    publishEditor();
    const context = getSegEditorToolContext();

    expect(context.toolGroup).toBe(toolGroup);
    expect(context.viewportIds).toEqual(VIEWPORT_IDS);
    expect(context.segmentationId).toBe(SEGMENTATION_ID);
    expect(listener).toHaveBeenCalledTimes(1);

    clearSegEditorToolContext(TOOL_GROUP_ID);
    expect(getSegEditorToolContext()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('ignores a clear for a different tool group', () => {
    createEditorToolGroup();
    publishEditor();

    clearSegEditorToolContext('someOtherGroup');

    expect(getSegEditorToolContext()).not.toBeNull();
  });
});


describe('evaluators', () => {
  const toolbarService = {
    getToolNameForButton: button => button.props?.commands?.commandOptions?.toolName ?? button.id,
    getOptionById: (button, optionId) => button.props.options.find(option => option.id === optionId),
  };
  const evaluators = Object.fromEntries(
    getSegEditorEvaluators({ servicesManager: { services: { toolbarService } } }).map(entry => [
      entry.name,
      entry.evaluate,
    ])
  );
  const brushButton = { id: 'Brush', props: {} };

  it('disables every palette tool while the editor is not open', () => {
    expect(evaluators[EVALUATORS.segmentation]({ button: brushButton, toolNames: ['CircularBrush'] }))
      .toMatchObject({ disabled: true, disabledText: 'The editor is not ready' });
    expect(evaluators[EVALUATORS.tool]({ button: { id: 'Zoom', props: {} } }))
      .toMatchObject({ disabled: true });
  });

  it('disables labelmap tools until the working segmentation has a segment', () => {
    createEditorToolGroup();
    publishEditor({ segments: {} });

    expect(evaluators[EVALUATORS.segmentation]({ button: brushButton, toolNames: ['CircularBrush'] }))
      .toMatchObject({ disabled: true, disabledText: 'Add a segment to enable this tool' });
  });

  it('marks a labelmap tool active while one of its instances holds the primary binding', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const evaluate = evaluators[EVALUATORS.segmentation];
    const toolNames = ['CircularBrush', 'SphereBrush'];

    expect(evaluate({ button: brushButton, toolNames })).toEqual({ disabled: false, isActive: false });

    toolGroup.setToolPassive('WindowLevel');
    toolGroup.setToolActive('SphereBrush', { bindings: [{ mouseButton: MouseBindings.Primary }] });

    expect(evaluate({ button: brushButton, toolNames })).toEqual({ disabled: false, isActive: true });
  });

  it('marks an imaging tool active only while it holds the primary binding', () => {
    createEditorToolGroup();
    publishEditor();
    const zoom = { id: 'Zoom', props: { commands: { commandOptions: { toolName: 'Zoom' } } } };
    const windowLevel = { id: 'WindowLevel', props: { commands: { commandOptions: { toolName: 'WindowLevel' } } } };

    // Zoom is bound to the right button only
    expect(evaluators[EVALUATORS.tool]({ button: zoom })).toEqual({ disabled: false, isActive: false });
    expect(evaluators[EVALUATORS.tool]({ button: windowLevel })).toEqual({ disabled: false, isActive: true });
  });

  it('copies the shared brush size into the radius option', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    toolGroup.brushSize = 12;
    const button = { id: 'Brush', props: { options: [{ id: 'brush-radius', value: 25 }] } };

    evaluators[EVALUATORS.synchronizeDrawingRadius]({ button, radiusOptionId: 'brush-radius' });

    expect(button.props.options[0].value).toBe(12);
  });
});


describe('commands', () => {
  it('moves the primary binding to a labelmap tool and back to an imaging tool', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setToolActiveToolbar', { value: 'CircularBrush' });

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('CircularBrush');
    expect(toolGroup.tools.WindowLevel.mode).toBe('Passive');

    run('setToolActiveToolbar', { toolName: 'WindowLevel' });

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('WindowLevel');
    expect(toolGroup.tools.CircularBrush.mode).toBe('Passive');
  });

  it('keeps Zoom on the right button when it gives up the primary binding', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setToolActiveToolbar', { toolName: 'Zoom' });
    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('Zoom');

    run('setToolActiveToolbar', { value: 'RectangleScissor' });

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('RectangleScissor');
    expect(toolGroup.tools.Zoom.mode).toBe('Active');
    expect(toolGroup.tools.Zoom.bindings).toEqual([{ mouseButton: MouseBindings.Secondary }]);
  });

  it('ignores tools the editor tool group does not have', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setToolActive', { toolName: 'Crosshairs' });

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('WindowLevel');
  });

  it('returns the primary binding to Window/Level when a labelmap tool is released', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const toolbarService = { refreshToolbarState: jest.fn() };
    const { run } = createCommands(toolbarService);

    run('setToolActiveToolbar', { value: 'ThresholdSphereBrushDynamic' });
    run('deactivateLabelmapTools');

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('WindowLevel');
    expect(toolGroup.tools.ThresholdSphereBrushDynamic.mode).toBe('Passive');
    expect(toolbarService.refreshToolbarState).toHaveBeenCalled();
  });

  it('leaves an imaging tool in place when released from the Labelmap palette', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setToolActiveToolbar', { toolName: 'Pan' });
    run('deactivateLabelmapTools');

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('Pan');
  });

  it('makes the working copy the active segmentation on every 2D view', () => {
    createEditorToolGroup();
    publishEditor();
    cstMock.__testing.activeSegmentations['seg-Axial'] = { segmentationId: SEGMENTATION_ID };
    cstMock.__testing.activeSegmentations['seg-Coronal'] = { segmentationId: 'source-seg' };
    const { run } = createCommands();

    run('activateSelectedSegmentationOfType', { segmentationRepresentationType: 'Labelmap' });

    const { setActiveSegmentation } = cstMock.segmentation.activeSegmentation;
    expect(setActiveSegmentation.mock.calls).toEqual([
      ['seg-Coronal', SEGMENTATION_ID],
      ['seg-Sagittal', SEGMENTATION_ID],
    ]);
  });

  it('sets, steps and clamps the shared brush size', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setBrushSize', { value: '10' });
    expect(toolGroup.brushSize).toBe(10);

    run('increaseBrushSize');
    expect(toolGroup.brushSize).toBe(13);

    run('setBrushSize', { value: 500 });
    expect(toolGroup.brushSize).toBe(99.5);
  });

  it('sets the threshold range on the named tools only', () => {
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const { run } = createCommands();

    run('setThresholdRange', { value: [100, 300], toolNames: ['ThresholdCircularBrush', 'NotATool'] });

    expect(toolGroup.tools.ThresholdCircularBrush.configuration.threshold).toEqual({ range: [100, 300] });
    expect(toolGroup.tools.ThresholdSphereBrush.configuration.threshold).toBeUndefined();
  });

  it('steps the active 2D viewport through its slices, up being the previous image', () => {
    const { run } = createCommands();
    publishEditor();
    const axial = new (require('@cornerstonejs/core').VolumeViewport)();
    const coronal = new (require('@cornerstonejs/core').VolumeViewport)();
    mockCore.viewports = { [VIEWPORT_IDS[0]]: axial, [VIEWPORT_IDS[1]]: coronal };
    mockCore.scroll.mockClear();

    run('nextImage');
    expect(mockCore.scroll).toHaveBeenLastCalledWith(axial, { delta: 1, volumeId: 'volume' });

    setSegEditorActiveViewport(VIEWPORT_IDS[1]);
    run('previousImage');
    expect(mockCore.scroll).toHaveBeenLastCalledWith(coronal, { delta: -1, volumeId: 'volume' });
  });

  it('undoes and redoes through Cornerstone3D\'s history, committing the active tool\'s edit first', () => {
    const { run } = createCommands();
    const toolGroup = createEditorToolGroup();
    publishEditor();
    const doneEditMemo = jest.fn();
    toolGroup.getToolInstance = () => ({ doneEditMemo });
    Object.assign(mockCore.history, { canUndo: true, canRedo: true });

    run('undoSegEditor');
    expect(doneEditMemo).toHaveBeenCalled();
    expect(mockCore.history.undo).toHaveBeenCalledTimes(1);

    run('redoSegEditor');
    expect(mockCore.history.redo).toHaveBeenCalledTimes(1);

    Object.assign(mockCore.history, { canUndo: false, canRedo: false });
    run('undoSegEditor');
    run('redoSegEditor');
    expect(mockCore.history.undo).toHaveBeenCalledTimes(1);
    expect(mockCore.history.redo).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the editor is closed', () => {
    const { run } = createCommands();

    expect(() => {
      run('setToolActiveToolbar', { value: 'CircularBrush' });
      run('deactivateLabelmapTools');
      run('setBrushSize', { value: 5 });
      run('activateSelectedSegmentationOfType');
    }).not.toThrow();
  });
});


describe('palette through the ToolbarService', () => {
  function createPalette() {
    const toolGroup = createEditorToolGroup();

    // Button UI types, as the cornerstone extension's toolbar module supplies them in the app
    const uiTypes = ['ohif.toolButton', 'ohif.toolBoxButton', 'ohif.toolBoxButtonGroup'].map(name => ({
      name,
      defaultComponent: () => null,
    }));
    const extensionManager = { modules: { toolbarModule: [{ module: { definitions: [], uiTypes } }] } };
    const servicesManager = {
      services: { viewportGridService: { getActiveViewportId: () => 'viewport-0' } },
    };
    const { commandsManager, run } = createCommands();
    const toolbarService = SonadorToolbarService.REGISTRATION.create({
      commandsManager,
      extensionManager,
      servicesManager,
    });
    servicesManager.services.toolbarService = toolbarService;

    // As the extension manager does for the seg-editor toolbar module's uiTypes
    getSegEditorEvaluators({ servicesManager }).forEach(({ name, evaluate }) =>
      toolbarService.registerEvaluateFunction(name, evaluate)
    );

    registerSegEditorToolbar(servicesManager);
    publishEditor();

    // What useToolbar.onInteraction does for a click
    const click = itemId => {
      const buttonProps = toolbarService.getButtonProps(itemId);
      const commands = buildButtonCommands(buttonProps, { itemId }, { servicesManager, commandsManager });
      toolbarService.recordInteraction({ itemId, ...buttonProps, commands }, { refreshProps: {} });
    };

    const isActive = id => !!toolbarService.getButtonProps(id).isActive;

    return { toolbarService, toolGroup, click, isActive, run };
  }

  it('registers the palette sections', () => {
    const { toolbarService } = createPalette();

    expect(toolbarService.state.buttonSections[SECTIONS.labelMapToolbox]).toEqual([SECTIONS.labelMapTools]);
    expect(toolbarService.state.buttonSections[SECTIONS.labelMapTools])
      .toEqual([POINTER_BUTTONS.labelmap, SECTIONS.brushTools, 'Shapes']);
    expect(toolbarService.state.buttonSections[SECTIONS.brushTools]).toEqual(['Brush', 'Eraser', 'Threshold']);
    expect(toolbarService.state.buttonSections[SECTIONS.imagingTools])
      .toEqual(['WindowLevel', 'Zoom', 'Pan', 'SegEditorUndo', 'SegEditorRedo']);
  });

  it('starts with Window/Level active and no labelmap tool active', () => {
    const { isActive } = createPalette();

    expect(isActive('WindowLevel')).toBe(true);
    expect(['Brush', 'Eraser', 'Threshold', 'Shapes'].some(isActive)).toBe(false);
  });

  it('clicking Brush activates its current shape and deselects Window/Level', () => {
    const { click, isActive, toolGroup } = createPalette();

    click('Brush');

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('CircularBrush');
    expect(isActive('Brush')).toBe(true);
    expect(isActive('WindowLevel')).toBe(false);
  });

  it('clicking an imaging tool deselects the labelmap tool', () => {
    const { click, isActive, toolGroup } = createPalette();

    click('Eraser');
    click('Zoom');

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('Zoom');
    expect(isActive('Eraser')).toBe(false);
    expect(isActive('Zoom')).toBe(true);
  });

  it('only one labelmap tool is active at a time', () => {
    const { click, isActive } = createPalette();

    click('Brush');
    click('Shapes');

    expect(isActive('Brush')).toBe(false);
    expect(isActive('Shapes')).toBe(true);
  });

  it('clicking Threshold activates the dynamic circular brush by default', () => {
    const { click, toolGroup } = createPalette();

    click('Threshold');

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('ThresholdCircularBrushDynamic');
  });

  it('changing the Brush shape option swaps the active instance', () => {
    const { click, toolbarService, toolGroup, isActive } = createPalette();
    click('Brush');

    const [labelMapTools] = toolbarService.getButtonSection(SECTIONS.labelMapToolbox);
    expect(labelMapTools).toBeDefined();
    const [brush] = toolbarService.getButtonSection(SECTIONS.brushTools);
    brush.componentProps.options.find(option => option.id === 'brush-mode').onChange('SphereBrush');
    toolbarService.refreshToolbarState({});

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('SphereBrush');
    expect(isActive('Brush')).toBe(true);
  });

  it('leaving the Labelmap palette releases the labelmap tool', () => {
    const { click, isActive, run, toolbarService } = createPalette();
    click('Shapes');

    run('deactivateLabelmapTools');
    toolbarService.refreshToolbarState({});

    expect(isActive('Shapes')).toBe(false);
    expect(isActive('WindowLevel')).toBe(true);
  });

  describe('3D tools', () => {
    it('registers the 3D palette sections', () => {
      const { toolbarService } = createPalette();

      expect(toolbarService.state.buttonSections[SECTIONS.threeDToolbox]).toEqual([SECTIONS.threeDTools]);
      expect(toolbarService.state.buttonSections[SECTIONS.threeDTools])
        .toEqual([POINTER_BUTTONS.threeD, THREE_D_TOOLS.Selection]);
    });

    it('disables Selection until the 3D canvas has an editable target, with the reason', () => {
      const { toolbarService } = createPalette();
      const selection = () => toolbarService.getButtonProps(THREE_D_TOOLS.Selection);

      expect(selection().disabled).toBe(true);

      set3DToolTarget({ segmentIndex: 1, disabledReason: 'The selected segment is locked' });
      expect(selection().disabled).toBe(true);
      expect(selection().disabledText).toBe('The selected segment is locked');

      set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
      expect(selection().disabled).toBe(false);

      set3DToolBusy(true);
      expect(selection().disabled).toBe(true);
    });

    it('clicking Selection activates it, and clicking again releases it', () => {
      const { click, isActive, toolGroup } = createPalette();
      set3DToolTarget({ segmentIndex: 1, label: 'Liver' });

      click(THREE_D_TOOLS.Selection);
      expect(get3DToolState().activeTool).toBe(THREE_D_TOOLS.Selection);
      expect(isActive(THREE_D_TOOLS.Selection)).toBe(true);
      // The 2D tool group is not involved
      expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('WindowLevel');

      click(THREE_D_TOOLS.Selection);
      expect(get3DToolState().activeTool).toBeNull();
      expect(isActive(THREE_D_TOOLS.Selection)).toBe(false);
    });

    it('keeps the Selection options in step with the tool state', () => {
      const { toolbarService, run } = createPalette();
      set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
      const option = id => toolbarService.getButtonProps(THREE_D_TOOLS.Selection).options
        .find(entry => entry.id === id);

      run('setSegEditor3DRemovalDepth', { value: 6 });
      toolbarService.refreshToolbarState({});
      expect(get3DToolState().removalDepth).toBe(6);
      expect(option('removal-depth').value).toBe(6);
    });

    it('the Remove and Clear options ask the 3D canvas to act', () => {
      const { toolbarService } = createPalette();
      const deleteSelection = jest.fn();
      const clearSelection = jest.fn();
      handle3DToolRequest('deleteSelection', deleteSelection);
      handle3DToolRequest('clearSelection', clearSelection);
      set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
      set3DSelectionCount(3);

      const selection = toolbarService.getButtonSection(SECTIONS.threeDTools)
        .find(button => button.id === THREE_D_TOOLS.Selection);
      const options = selection.componentProps.options;
      options.find(entry => entry.id === 'remove-selection').onChange();
      options.find(entry => entry.id === 'clear-selection').onChange();

      expect(deleteSelection).toHaveBeenCalledTimes(1);
      expect(clearSelection).toHaveBeenCalledTimes(1);
    });

    it('leaving the 3D palette releases the 3D tool', () => {
      const { click, isActive, run } = createPalette();
      set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
      click(THREE_D_TOOLS.Selection);

      run('deactivate3DTools');

      expect(isActive(THREE_D_TOOLS.Selection)).toBe(false);
    });
  });

  it('the Labelmap Pointer is active until a labelmap tool is chosen', () => {
    const { click, isActive } = createPalette();

    expect(isActive(POINTER_BUTTONS.labelmap)).toBe(true);
    click('Brush');
    expect(isActive(POINTER_BUTTONS.labelmap)).toBe(false);
  });

  it('the Labelmap Pointer puts back the default 2D navigation', () => {
    const { click, isActive, toolGroup } = createPalette();
    click('Zoom');   // Zoom on the left button (and still on the right)
    click('Eraser');

    click(POINTER_BUTTONS.labelmap);

    expect(toolGroup.getActivePrimaryMouseButtonTool()).toBe('WindowLevel');
    const bindings = name => toolGroup.tools[name].bindings.map(b => b.mouseButton);
    expect(bindings('Zoom')).toEqual([MouseBindings.Secondary]);
    expect(bindings('Pan')).toEqual([MouseBindings.Auxiliary]);
    expect(bindings('StackScroll')).toEqual([MouseBindings.Wheel]);
    expect(isActive(POINTER_BUTTONS.labelmap)).toBe(true);
    expect(isActive('Eraser')).toBe(false);
  });

  it('the 3D Pointer releases the active 3D tool', () => {
    const { click, isActive } = createPalette();
    set3DToolTarget({ segmentIndex: 1, label: 'Liver' });
    expect(isActive(POINTER_BUTTONS.threeD)).toBe(true);

    click(THREE_D_TOOLS.Selection);
    expect(isActive(POINTER_BUTTONS.threeD)).toBe(false);

    click(POINTER_BUTTONS.threeD);
    expect(get3DToolState().activeTool).toBeNull();
    expect(isActive(POINTER_BUTTONS.threeD)).toBe(true);
    expect(isActive(THREE_D_TOOLS.Selection)).toBe(false);
  });

  it('disables the labelmap tools once the editor closes', () => {
    const { toolbarService } = createPalette();

    clearSegEditorToolContext(TOOL_GROUP_ID);
    toolbarService.refreshToolbarState({});

    expect(toolbarService.getButtonProps('Brush').disabled).toBe(true);
    expect(toolbarService.getButtonProps('WindowLevel').disabled).toBe(true);
  });
});
