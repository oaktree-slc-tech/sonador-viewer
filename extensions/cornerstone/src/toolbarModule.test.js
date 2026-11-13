// The MPR view (ACTIVE_VIEWPORT::VTK) offers no Series Tag button: a series is tagged from the
// classic viewport.

jest.mock('@ohif/ui', () => ({ TOOLBAR_BUTTON_TYPES: { COMMAND: 'command', SET_TOOL_ACTIVE: 'setToolActive', BUILT_IN: 'builtIn' }, TOOLBAR_BUTTON_BEHAVIORS: {} }),
  { virtual: true });
jest.mock('./toolbarComponents/SeriesTagToolbarButton.js', () => ({ SeriesTagToolbarButton: () => null }));
jest.mock('./toolbarComponents/DistortionFilterToolbarButton.js', () => ({ DistortionFilterToolbarButton: () => null }));
jest.mock('./toolbarComponents/LocalCacheToolbarButton.js', () => ({ LocalCacheToolbarButton: () => null }));
jest.mock('./toolbarComponents/CreateSegmentationToolbarButton.js', () => ({ CreateSegmentationToolbarButton: () => null }));
jest.mock('./toolbarComponents/DownloadStudyToolbarButton.js', () => ({ DownloadStudyToolbarButton: () => null }));
jest.mock('./toolbarComponents/RemoveStudyToolbarButton.js', () => ({ RemoveStudyToolbarButton: () => null }));
jest.mock('./toolbarUITypes', () => ({}));

import toolbarModule from './toolbarModule';

const flatten = buttons => buttons.flatMap(button => [button, ...flatten(button.buttons || [])]);
const contextOf = button => button.context || toolbarModule.defaultContext;

it('offers the Series Tag in the classic viewport only, not in the MPR view', () => {
  const seriesTags = flatten(toolbarModule.definitions).filter(button => button.commandName === 'seriesTagDialog');
  expect(seriesTags.length).toBeGreaterThan(0);
  seriesTags.forEach(button => expect(contextOf(button)).not.toContain('ACTIVE_VIEWPORT::VTK'));
  expect(flatten(toolbarModule.definitions).filter(button => contextOf(button) === 'ACTIVE_VIEWPORT::VTK').map(button => button.id))
    .toEqual(['Exit2DMPR']);
});
