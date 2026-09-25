import SonadorToolbarService from './SonadorToolbarService';
import { getToolbarUITypeEntries } from './toolbarModuleEntries';

// Node test environment: PubSubService._broadcastEvent also dispatches a CustomEvent on
// document.body (same shim as UINotificationService.test.js).
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

const ToolButton = () => null;
const ToolBoxButton = () => null;

function createToolbarService({ toolbarModules } = {}) {
  const commandsManager = { run: jest.fn() };
  const extensionManager = {
    modules: {
      toolbarModule: toolbarModules ?? [
        // v2 module: read by ToolbarRow only
        { extensionId: 'legacy', module: { definitions: [{ id: 'Zoom' }], defaultContext: 'X' } },
        // v2 module that also carries OHIF v3 button UI types
        {
          extensionId: 'hybrid',
          module: {
            definitions: [],
            uiTypes: [{ name: 'ohif.toolButton', defaultComponent: ToolButton }],
          },
        },
        // OHIF v3 module
        {
          extensionId: 'v3',
          module: [{ name: 'ohif.toolBoxButton', defaultComponent: ToolBoxButton }],
        },
      ],
    },
  };
  const servicesManager = {
    services: { viewportGridService: { getActiveViewportId: () => 'viewport-1' } },
  };

  const service = SonadorToolbarService.REGISTRATION.create({
    commandsManager,
    extensionManager,
    servicesManager,
  });

  return { service, commandsManager };
}

describe('getToolbarUITypeEntries', () => {
  it('returns OHIF v3 array modules as-is', () => {
    const entries = [{ name: 'a' }];
    expect(getToolbarUITypeEntries(entries)).toBe(entries);
  });

  it('returns the uiTypes of a v2 module', () => {
    const uiTypes = [{ name: 'a' }];
    expect(getToolbarUITypeEntries({ definitions: [], uiTypes })).toBe(uiTypes);
  });

  it('returns nothing for a plain v2 module or a missing module', () => {
    expect(getToolbarUITypeEntries({ definitions: [{ id: 'Zoom' }] })).toEqual([]);
    expect(getToolbarUITypeEntries(undefined)).toEqual([]);
  });
});

describe('SonadorToolbarService', () => {
  it('registers under the OHIF v3 service names', () => {
    expect(SonadorToolbarService.REGISTRATION.name).toBe('toolbarService');
    expect(SonadorToolbarService.REGISTRATION.altName).toBe('ToolBarService');
  });

  it('resolves button UI types from v3 and hybrid modules and skips plain v2 modules', () => {
    const { service } = createToolbarService();

    const uiTypes = service._getButtonUITypes();

    expect(Object.keys(uiTypes).sort()).toEqual(['ohif.toolBoxButton', 'ohif.toolButton']);
    expect(service.getButtonComponentForUIType('ohif.toolButton')).toBe(ToolButton);
  });

  it('returns no UI types when no toolbar modules are registered', () => {
    const { service } = createToolbarService({ toolbarModules: null });
    service._extensionManager = { modules: {} };

    expect(service._getButtonUITypes()).toEqual({});
  });

  it('maps a registered section to display components', () => {
    const { service } = createToolbarService();
    service.register([
      { id: 'Brush', uiType: 'ohif.toolBoxButton', props: { id: 'Brush', icon: 'x', label: 'Brush' } },
      { id: 'Zoom', uiType: 'ohif.toolButton', props: { id: 'Zoom', icon: 'y', label: 'Zoom' } },
    ]);
    service.updateSection('segTools', ['Brush', 'Zoom']);

    const section = service.getButtonSection('segTools');

    expect(section.map(button => button.id)).toEqual(['Brush', 'Zoom']);
    expect(section[0].Component).toBe(ToolBoxButton);
    expect(section[1].Component).toBe(ToolButton);
    expect(section[0].componentProps.label).toBe('Brush');
  });

  it('evaluates named evaluators on refresh, including hideWhenDisabled', () => {
    const { service } = createToolbarService();
    service.registerEvaluateFunction('evaluate.active', ({ button }) => ({
      disabled: false,
      isActive: button.id === 'Brush',
    }));
    service.registerEvaluateFunction('evaluate.off', () => ({ disabled: true }));
    service.register([
      { id: 'Brush', uiType: 'ohif.toolButton', props: { evaluate: 'evaluate.active' } },
      { id: 'Eraser', uiType: 'ohif.toolButton', props: { evaluate: 'evaluate.active' } },
      {
        id: 'AI',
        uiType: 'ohif.toolButton',
        props: { evaluate: 'evaluate.off', hideWhenDisabled: true },
      },
    ]);

    service.refreshToolbarState({ viewportId: 'viewport-1' });

    expect(service.getButtonProps('Brush').isActive).toBe(true);
    expect(service.getButtonProps('Eraser').isActive).toBe(false);
    expect(service.getButtonProps('AI').disabled).toBe(true);
    expect(service.getButtonProps('AI').visible).toBe(false);
  });

  it('merges array evaluators and lets any disabled result win', () => {
    const { service } = createToolbarService();
    service.registerEvaluateFunction('evaluate.active', () => ({ isActive: true }));
    service.registerEvaluateFunction('evaluate.needsSegment', () => ({
      disabled: true,
      disabledText: 'Add a segment',
    }));
    service.register([
      {
        id: 'Brush',
        uiType: 'ohif.toolButton',
        props: { evaluate: ['evaluate.active', 'evaluate.needsSegment'] },
      },
    ]);

    service.refreshToolbarState({});

    const props = service.getButtonProps('Brush');
    expect(props.isActive).toBe(true);
    expect(props.disabled).toBe(true);
    expect(props.disabledText).toBe('Add a segment');
  });

  it('evaluates the buttons of a nested section through its group button', () => {
    const { service } = createToolbarService();
    service.registerEvaluateFunction('evaluate.active', ({ button }) => ({
      isActive: button.id === 'Eraser',
    }));
    service.register([
      { id: 'BrushTools', uiType: 'ohif.toolBoxButton', props: { buttonSection: true } },
      { id: 'Brush', uiType: 'ohif.toolButton', props: { evaluate: 'evaluate.active' } },
      { id: 'Eraser', uiType: 'ohif.toolButton', props: { evaluate: 'evaluate.active' } },
    ]);
    service.updateSection('BrushTools', ['Brush', 'Eraser']);

    // Mapping the group resolves the evaluators of the nested section (as the toolbox does)
    service.getButtonSection('BrushTools');
    service.refreshToolbarState({});

    expect(service.getButtonProps('BrushTools').buttonSection).toBe('BrushTools');
    expect(service.getButtonProps('Brush').isActive).toBe(false);
    expect(service.getButtonProps('Eraser').isActive).toBe(true);
  });

  it('runs interaction commands with the interaction options and refreshes state', () => {
    const { service, commandsManager } = createToolbarService();
    const evaluate = jest.fn(() => ({ isActive: true }));
    service.register([
      {
        id: 'Brush',
        uiType: 'ohif.toolButton',
        props: {
          evaluate,
          commands: [{ commandName: 'setToolActiveToolbar', commandOptions: { toolName: 'CircularBrush' } }],
        },
      },
    ]);

    // Same shape useToolbar.onInteraction passes: the clicked item id plus the button props
    service.recordInteraction(
      { itemId: 'Brush', ...service.getButtonProps('Brush') },
      { refreshProps: { viewportId: 'viewport-1' } }
    );

    expect(commandsManager.run).toHaveBeenCalledTimes(1);
    const [commands, options] = commandsManager.run.mock.calls[0];
    expect(commands[0].commandName).toBe('setToolActiveToolbar');
    expect(options.itemId).toBe('Brush');
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ viewportId: 'viewport-1' }));
    expect(service.getButtonProps('Brush').isActive).toBe(true);
  });

  it('runs option commands with the new value and records it on the button', () => {
    const { service, commandsManager } = createToolbarService();
    const listener = jest.fn();
    service.subscribe(service.EVENTS.TOOL_BAR_STATE_MODIFIED, listener);
    service.register([
      {
        id: 'Brush',
        uiType: 'ohif.toolButton',
        props: {
          options: [
            {
              id: 'brush-radius',
              type: 'range',
              value: 25,
              explicitRunOnly: true,
              commands: { commandName: 'setBrushSize' },
            },
          ],
        },
      },
    ]);
    service.updateSection('tools', ['Brush']);

    const [brush] = service.getButtonSection('tools');
    brush.componentProps.options[0].onChange(10);

    expect(commandsManager.run).toHaveBeenCalledWith(
      { commandName: 'setBrushSize' },
      expect.objectContaining({ id: 'brush-radius', value: 10 })
    );
    expect(service.getButtonProps('Brush').options[0].value).toBe(10);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('throws when a button names an evaluator that is not registered', () => {
    const { service } = createToolbarService();
    service.register([{ id: 'Brush', uiType: 'ohif.toolButton', props: { evaluate: 'nope' } }]);

    expect(() => service.refreshToolbarState({})).toThrow(/Evaluate function not found/);
  });
});
