import { buildButtonCommands } from './buildButtonCommands';

describe('buildButtonCommands', () => {
  const servicesManager = { services: {} };

  it('runs item commands, then option commands, skipping explicitRunOnly options', () => {
    const commandsManager = { run: jest.fn() };
    const buttonProps = {
      id: 'Brush',
      commands: 'activateSelectedSegmentationOfType',
      options: [
        { id: 'brush-radius', value: 25, explicitRunOnly: true, commands: 'setBrushSize' },
        { id: 'brush-mode', value: 'CircularBrush', commands: 'setToolActiveToolbar' },
        { id: 'no-commands', value: 1 },
      ],
    };

    const commands = buildButtonCommands(buttonProps, { itemId: 'Brush' }, {
      servicesManager,
      commandsManager,
    });
    commands.forEach(run => run());

    expect(commands).toHaveLength(2);
    expect(commandsManager.run).toHaveBeenNthCalledWith(1, 'activateSelectedSegmentationOfType', {
      itemId: 'Brush',
    });
    expect(commandsManager.run).toHaveBeenNthCalledWith(
      2,
      'setToolActiveToolbar',
      expect.objectContaining({
        id: 'brush-mode',
        value: 'CircularBrush',
        options: buttonProps.options,
        commandsManager,
        servicesManager,
      })
    );
  });

  it('returns no commands for a button without commands or options', () => {
    const commandsManager = { run: jest.fn() };

    expect(buildButtonCommands({ id: 'Info' }, {}, { servicesManager, commandsManager })).toEqual([]);
  });
});
