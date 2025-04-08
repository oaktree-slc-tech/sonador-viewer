const TOOLBAR_BUTTON_TYPES = {
  COMMAND: 'command',
  SET_TOOL_ACTIVE: 'setToolActive',
};

const definitions = [
  {
    id: 'ExitSegEditor',
    label: 'Exit',
    icon: 'times',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'closeSegEditor',
    commandOptions: {},
    uiOptions: { layoutButtonVisible: true },
  },
];

export default {
  definitions,
  defaultContext: 'ACTIVE_VIEWPORT::SONADOR3DSEG',
};
