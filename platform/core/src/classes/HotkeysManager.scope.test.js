// Scope guards and scope-preserving re-registration. The key-binding library is replaced by a
// factory mock so its browser-only plugins are never loaded.

jest.mock('./../utils/hotkeys', () => ({
  bind: jest.fn(),
  unbind: jest.fn(),
  reset: jest.fn(),
  pause: jest.fn(),
  unpause: jest.fn(),
  record: jest.fn(),
}));
jest.mock('./../log.js', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

import hotkeys from './../utils/hotkeys';
import HotkeysManager from './HotkeysManager';

const event = () => ({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

const lastBoundHandler = () => hotkeys.bind.mock.calls[hotkeys.bind.mock.calls.length - 1][1];

describe('HotkeysManager scopes', () => {
  let commandsManager;
  let manager;

  beforeEach(() => {
    hotkeys.bind.mockClear();
    hotkeys.unbind.mockClear();
    commandsManager = { runCommand: jest.fn() };
    manager = new HotkeysManager(commandsManager, { services: {} });
  });

  it('runs an unscoped binding and consumes the key', () => {
    manager.setHotkeys([{ commandName: 'resetViewport', label: 'Reset', keys: ['space'] }]);
    const evt = event();

    lastBoundHandler()(evt);

    expect(commandsManager.runCommand).toHaveBeenCalledWith('resetViewport', { evt });
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('asks the scope guard first and leaves a refused key to the browser', () => {
    const guard = jest.fn(() => false);
    manager.setScopeGuard('viewport', guard);
    manager.setHotkeys([{ commandName: 'toggleOverlay', label: 'Toggle', keys: ['shift', 'space'], scope: 'viewport' }]);
    const evt = event();

    lastBoundHandler()(evt);

    expect(guard).toHaveBeenCalledWith(evt);
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('dispatches when the guard allows', () => {
    manager.setScopeGuard('viewport', () => true);
    manager.setHotkeys([{ commandName: 'toggleOverlay', label: 'Toggle', keys: ['shift', 'space'], scope: 'viewport' }]);
    const evt = event();

    lastBoundHandler()(evt);

    expect(commandsManager.runCommand).toHaveBeenCalledWith('toggleOverlay', { evt });
    expect(hotkeys.bind.mock.calls[0][0]).toBe('shift+space');
  });

  it('keeps the scope when a stored customisation re-registers keys and label only', () => {
    manager.setScopeGuard('viewport', () => false);
    manager.setHotkeys([{ commandName: 'toggleOverlay', label: 'Toggle', keys: ['shift', 'space'], scope: 'viewport' }]);
    manager.setHotkeys({ toggleOverlay: { label: 'Toggle', keys: ['ctrl', 'o'] } });

    expect(manager.hotkeyDefinitions.toggleOverlay).toEqual({ keys: ['ctrl', 'o'], label: 'Toggle', scope: 'viewport' });
    expect(hotkeys.unbind).toHaveBeenCalledWith('shift+space');

    lastBoundHandler()(event());
    expect(commandsManager.runCommand).not.toHaveBeenCalled();
  });

  it('does not add a scope key to definitions that have none', () => {
    manager.setHotkeys([{ commandName: 'invertViewport', label: 'Invert', keys: ['i'] }]);

    expect(manager.hotkeyDefinitions.invertViewport).toEqual({ keys: ['i'], label: 'Invert' });
  });

  it('merges defaults under stored bindings so a new default appears and customisations win', () => {
    const defaults = [
      { commandName: 'invertViewport', label: 'Invert', keys: ['i'] },
      { commandName: 'toggleOverlay', label: 'Toggle Viewport Display', keys: ['shift', 'space'], scope: 'viewport' },
    ];
    manager.setHotkeys(defaults);
    manager.setHotkeys({ invertViewport: { label: 'Invert', keys: ['x'] } });

    expect(manager.hotkeyDefinitions.invertViewport.keys).toEqual(['x']);
    expect(manager.hotkeyDefinitions.toggleOverlay.keys).toEqual(['shift', 'space']);
  });
});
