import log from './../log.js';
import CommandsManager from './CommandsManager.js';

jest.mock('./../log.js');

describe('CommandsManager', () => {
  let commandsManager,
    contextName = 'VTK',
    command = {
      commandFn: jest.fn().mockReturnValue(true),
      storeContexts: ['viewers'],
      options: { passMeToCommandFn: ':wave:' },
    },
    commandsManagerConfig = {
      getAppState: () => {
        return {
          viewers: 'Test',
        };
      },
      getActiveContexts: () => ['VIEWER', 'ACTIVE_VIEWER::CORNERSTONE'],
    };

  beforeEach(() => {
    commandsManager = new CommandsManager(commandsManagerConfig);
    commandsManager.createContext('VIEWER');
    commandsManager.createContext('ACTIVE_VIEWER::CORNERSTONE');
    jest.clearAllMocks();
  });

  it('has a contexts property', () => {
    const localCommandsManager = new CommandsManager(commandsManagerConfig);

    expect(localCommandsManager).toHaveProperty('contexts');
    expect(localCommandsManager.contexts).toEqual({});
  });

  it('logs a warning if instantiated without getAppState or getActiveContexts', () => {
    new CommandsManager();

    expect(log.warn.mock.calls.length).toBe(1);
  });

  describe('createContext()', () => {
    it('creates a context', () => {
      commandsManager.createContext(contextName);

      expect(commandsManager.contexts).toHaveProperty(contextName);
    });

    it('clears the context if it already exists', () => {
      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', command);
      commandsManager.registerCommand(contextName, 'TestCommand2', command);
      commandsManager.createContext(contextName);

      const registeredCommands = commandsManager.getContext(contextName);

      expect(registeredCommands).toEqual({});
    });
  });

  describe('getContext()', () => {
    it('returns all registered commands for a context', () => {
      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', command);
      const registeredCommands = commandsManager.getContext(contextName);

      expect(registeredCommands).toHaveProperty('TestCommand');
      expect(registeredCommands['TestCommand']).toEqual(command);
    });
    it('returns undefined if the context does not exist', () => {
      const registeredCommands = commandsManager.getContext(contextName);

      expect(registeredCommands).toBe(undefined);
    });
  });

  describe('clearContext()', () => {
    it('clears all registered commands for a context', () => {
      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', command);
      commandsManager.registerCommand(contextName, 'TestCommand2', command);
      commandsManager.clearContext(contextName);

      const registeredCommands = commandsManager.getContext(contextName);

      expect(registeredCommands).toEqual({});
    });
  });

  describe('registerCommand()', () => {
    it('registers commands to a context', () => {
      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', command);
      const registeredCommands = commandsManager.getContext(contextName);

      expect(registeredCommands).toHaveProperty('TestCommand');
      expect(registeredCommands['TestCommand']).toEqual(command);
    });
  });

  describe('getCommand()', () => {
    it('returns undefined if context does not exist', () => {
      const result = commandsManager.getCommand('TestCommand', 'NonExistentContext');

      expect(result).toBe(undefined);
    });
    it('returns undefined if command does not exist in context', () => {
      commandsManager.createContext(contextName);
      const result = commandsManager.getCommand('TestCommand', contextName);

      expect(result).toBe(undefined);
    });
    it('uses contextName param to get command', () => {
      commandsManager.createContext('GLOBAL');
      commandsManager.registerCommand('GLOBAL', 'TestCommand', command);
      const foundCommand = commandsManager.getCommand('TestCommand', 'GLOBAL');

      expect(foundCommand).toBe(command);
    });
    it('uses activeContexts, if contextName is not provided, to get command', () => {
      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      const foundCommand = commandsManager.getCommand('TestCommand');

      expect(foundCommand).toBe(command);
    });
    it('returns the expected command', () => {
      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', command);
      const result = commandsManager.getCommand('TestCommand', contextName);

      expect(result).toEqual(command);
    });
  });

  describe('runCommand()', () => {
    it('Logs a warning if commandName not found in context', () => {
      const result = commandsManager.runCommand('CommandThatDoesNotExistInAnyContext');

      expect(result).toBe(undefined);
      expect(log.warn.mock.calls[0][0]).toEqual(
        'Command "CommandThatDoesNotExistInAnyContext" not found in current context'
      );
    });

    it('Logs a warning if command definition does not have a commandFn', () => {
      const commandWithNoCommmandFn = {
        commandFn: undefined,
        storeContexts: [],
        options: {},
      };

      commandsManager.createContext(contextName);
      commandsManager.registerCommand(contextName, 'TestCommand', commandWithNoCommmandFn);
      const result = commandsManager.runCommand('TestCommand', null, contextName);

      expect(result).toBe(undefined);
      expect(log.warn.mock.calls[0][0]).toEqual('No commandFn was defined for command "TestCommand"');
    });

    it('Calls commandFn', () => {
      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      commandsManager.runCommand('TestCommand', {}, 'VIEWER');

      expect(command.commandFn.mock.calls.length).toBe(1);
    });

    it('Calls commandFn w/ properties from appState', () => {
      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      commandsManager.runCommand('TestCommand', {}, 'VIEWER');

      expect(command.commandFn.mock.calls.length).toBe(1);
      expect(command.commandFn.mock.calls[0][0].viewers).toEqual(commandsManagerConfig.getAppState().viewers);
    });

    it('Calls commandFn w/ command definition options', () => {
      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      commandsManager.runCommand('TestCommand', {}, 'VIEWER');

      expect(command.commandFn.mock.calls.length).toBe(1);
      expect(command.commandFn.mock.calls[0][0].passMeToCommandFn).toEqual(command.options.passMeToCommandFn);
    });

    it('Calls commandFn w/ runCommand "options" parameter', () => {
      const runCommandOptions = {
        test: ':+1:',
      };

      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      commandsManager.runCommand('TestCommand', runCommandOptions, 'VIEWER');

      expect(command.commandFn.mock.calls.length).toBe(1);
      expect(command.commandFn.mock.calls[0][0].test).toEqual(runCommandOptions.test);
    });

    it('Returns the result of commandFn', () => {
      commandsManager.registerCommand('VIEWER', 'TestCommand', command);
      const result = commandsManager.runCommand('TestCommand', {}, 'VIEWER');

      expect(command.commandFn.mock.calls.length).toBe(1);
      expect(result).toBe(true);
    });

    it('Calls a function passed in place of a command name', () => {
      const fn = jest.fn().mockReturnValue('ran');

      const result = commandsManager.runCommand(fn, { value: 3 });

      expect(fn).toHaveBeenCalledWith({ value: 3 });
      expect(result).toBe('ran');
    });

    it('Looks the command up across an array of contexts', () => {
      commandsManager.createContext('SONADOR3DSEG');
      commandsManager.registerCommand('SONADOR3DSEG', 'TestCommand', command);

      commandsManager.runCommand('TestCommand', {}, ['VIEWER', 'SONADOR3DSEG']);

      expect(command.commandFn.mock.calls.length).toBe(1);
    });
  });

  describe('run()', () => {
    let first, second;

    beforeEach(() => {
      first = { commandFn: jest.fn().mockReturnValue('first') };
      second = { commandFn: jest.fn().mockReturnValue('second') };
      commandsManager.registerCommand('VIEWER', 'First', first);
      commandsManager.registerCommand('VIEWER', 'Second', second);
    });

    it('runs a command given by name and returns its result', () => {
      expect(commandsManager.run('First')).toBe('first');
      expect(first.commandFn).toHaveBeenCalledTimes(1);
    });

    it('runs a command object in its context, with its commandOptions over the run options', () => {
      commandsManager.createContext('SONADOR3DSEG');
      const scoped = { commandFn: jest.fn() };
      commandsManager.registerCommand('SONADOR3DSEG', 'Scoped', scoped);

      commandsManager.run(
        { commandName: 'Scoped', commandOptions: { toolName: 'Brush' }, context: 'SONADOR3DSEG' },
        { toolName: 'Zoom', viewportId: 'vp' }
      );

      expect(scoped.commandFn.mock.calls[0][0]).toEqual(
        expect.objectContaining({ toolName: 'Brush', viewportId: 'vp' })
      );
    });

    it('runs an array of mixed forms in order and returns every result', () => {
      const fn = jest.fn().mockReturnValue('fn');

      const results = commandsManager.run(['First', { commandName: 'Second' }, fn]);

      expect(results).toEqual(['first', 'second', 'fn']);
      expect(first.commandFn.mock.invocationCallOrder[0]).toBeLessThan(
        second.commandFn.mock.invocationCallOrder[0]
      );
    });

    it('unwraps a { commands } holder', () => {
      commandsManager.run({ commands: ['First', 'Second'] });

      expect(first.commandFn).toHaveBeenCalledTimes(1);
      expect(second.commandFn).toHaveBeenCalledTimes(1);
    });

    it('runs nothing for empty or unrunnable input', () => {
      expect(commandsManager.run(undefined)).toEqual([]);
      expect(commandsManager.run({ notACommand: true })).toEqual([]);
      expect(first.commandFn).not.toHaveBeenCalled();
    });

    it('runAsync awaits each command before starting the next', async () => {
      const order = [];
      commandsManager.registerCommand('VIEWER', 'Slow', {
        commandFn: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          order.push('slow');
          return 'slow';
        },
      });
      commandsManager.registerCommand('VIEWER', 'Fast', {
        commandFn: () => {
          order.push('fast');
          return 'fast';
        },
      });

      const results = await commandsManager.runAsync(['Slow', 'Fast']);

      expect(order).toEqual(['slow', 'fast']);
      expect(results).toEqual(['slow', 'fast']);
    });
  });
});
