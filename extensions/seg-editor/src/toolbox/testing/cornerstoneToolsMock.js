// Stand-in for @cornerstonejs/tools in the tool palette tests. The fake ToolGroup follows the
// binding rules of the installed 4.22 ToolGroup: setToolActive merges bindings, setToolPassive
// removes only the primary binding (a tool with other bindings stays active), and the active
// primary tool is the first active tool holding the primary binding.

const MouseBindings = { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 };

const Events = {
  TOOL_ACTIVATED: 'TOOL_ACTIVATED',
  TOOL_MODE_CHANGED: 'TOOL_MODE_CHANGED',
  SEGMENTATION_MODIFIED: 'SEGMENTATION_MODIFIED',
  SEGMENTATION_REPRESENTATION_ADDED: 'SEGMENTATION_REPRESENTATION_ADDED',
  SEGMENTATION_REPRESENTATION_REMOVED: 'SEGMENTATION_REPRESENTATION_REMOVED',
  SEGMENTATION_REMOVED: 'SEGMENTATION_REMOVED',
};

const isPrimary = binding => binding.mouseButton === MouseBindings.Primary;
const sameBinding = (a, b) => a.mouseButton === b.mouseButton;

class FakeToolGroup {
  constructor(id) {
    this.id = id;
    this.tools = {};
    this.viewportIds = [];
    this.brushSize = undefined;
  }

  addTool(toolName, configuration = {}) {
    this.tools[toolName] = { mode: 'Disabled', bindings: [], configuration: { ...configuration } };
    if (configuration.activeStrategy && this.brushSize === undefined) {
      this.brushSize = 25;
    }
  }

  addToolInstance(toolName, parentClassName, configuration = {}) {
    this.addTool(toolName, { ...configuration, parentClassName });
  }

  hasTool(toolName) {
    return !!this.tools[toolName];
  }

  setToolActive(toolName, { bindings = [] } = {}) {
    const tool = this.tools[toolName];
    tool.bindings = [...tool.bindings, ...bindings].filter(
      (binding, index, all) => all.findIndex(other => sameBinding(other, binding)) === index
    );
    tool.mode = 'Active';
  }

  setToolPassive(toolName) {
    const tool = this.tools[toolName];
    tool.bindings = tool.bindings.filter(binding => !isPrimary(binding));
    tool.mode = tool.bindings.length ? 'Active' : 'Passive';
  }

  setToolDisabled(toolName) {
    this.tools[toolName].bindings = [];
    this.tools[toolName].mode = 'Disabled';
  }

  getActivePrimaryMouseButtonTool() {
    return Object.keys(this.tools).find(
      name => this.tools[name].mode === 'Active' && this.tools[name].bindings.some(isPrimary)
    );
  }

  getToolConfiguration(toolName) {
    return this.tools[toolName]?.configuration;
  }

  setToolConfiguration(toolName, configuration) {
    Object.assign(this.tools[toolName].configuration, configuration);
    return true;
  }

  getViewportIds() {
    return this.viewportIds;
  }
}

const _toolGroups = {};
const _segmentations = {};
const _activeSegmentations = {};

function createToolGroup(id) {
  _toolGroups[id] = new FakeToolGroup(id);
  return _toolGroups[id];
}

function reset() {
  [_toolGroups, _segmentations, _activeSegmentations].forEach(store =>
    Object.keys(store).forEach(key => delete store[key])
  );
}

const toolClass = toolName => ({ toolName });

module.exports = {
  // test helpers
  __testing: { createToolGroup, reset, segmentations: _segmentations, activeSegmentations: _activeSegmentations },

  Enums: { MouseBindings, Events },
  ToolGroupManager: { getToolGroup: id => _toolGroups[id] },
  addTool: jest.fn(),
  BrushTool: toolClass('Brush'),
  CircleScissorsTool: toolClass('CircleScissor'),
  SphereScissorsTool: toolClass('SphereScissor'),
  RectangleScissorsTool: toolClass('RectangleScissor'),
  segmentation: {
    state: { getSegmentation: id => _segmentations[id] },
    activeSegmentation: {
      getActiveSegmentation: viewportId => _activeSegmentations[viewportId],
      setActiveSegmentation: jest.fn((viewportId, segmentationId) => {
        _activeSegmentations[viewportId] = { segmentationId };
      }),
    },
  },
  utilities: {
    triggerAnnotationRenderForViewportIds: jest.fn(),
    segmentation: {
      getBrushToolInstances: toolGroupId => _toolGroups[toolGroupId]?.brushInstances ?? [],
      getBrushSizeForToolGroup: toolGroupId => _toolGroups[toolGroupId]?.brushSize,
      setBrushSizeForToolGroup: (toolGroupId, brushSize) => {
        _toolGroups[toolGroupId].brushSize = Math.min(Math.max(brushSize, 0.5), 99.5);
      },
    },
  },
};
