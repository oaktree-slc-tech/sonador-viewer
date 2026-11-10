// The volume viewer's connected viewport reads its pane from the layout, which can lack that pane
// for a moment (a layout change or a study reload, such as after removing a series).

jest.mock('@ohif/core', () => ({ __esModule: true, default: { redux: { actions: {} } } }), { virtual: true });
jest.mock('../ohifComponents/VTKVolumeViewportShell.js', () => () => null);

import { mapStateToProps } from './ConnectedVTKVolumeViewport';

const state = viewports => ({ viewports: { activeViewportIndex: 0, layout: { viewports } } });

it('maps the pane\'s plugin options', () => {
  expect(mapStateToProps(state([{ viewer3dvol: { mode: 'volume' } }]), { viewportIndex: 0 })).toMatchObject({ mode: 'volume', isActive: true });
});

it('maps a pane the layout does not hold yet without throwing', () => {
  expect(mapStateToProps(state([]), { viewportIndex: 1 })).toMatchObject({ isActive: false, activeViewportIndex: 0 });
  expect(() => mapStateToProps({ viewports: { activeViewportIndex: 0, layout: {} } }, { viewportIndex: 0 })).not.toThrow();
});
