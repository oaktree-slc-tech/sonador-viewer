// The segmentation editor's connected viewport reads its pane from the layout, which can lack that
// pane for a moment (a layout change or a study reload).

jest.mock('@ohif/core', () => ({ __esModule: true, default: { redux: { actions: {} } } }), { virtual: true });
jest.mock('../ohifComponents/OHIFSegmentationEditorViewport.js', () => () => null);

import { mapStateToProps } from './ConnectedSegmentationEditorViewport';

const state = viewports => ({ viewports: { activeViewportIndex: 0, layout: { viewports } } });

it('maps the pane\'s plugin options', () => {
  expect(mapStateToProps(state([{ sonador3dseg: { tab: '3d' } }]), { viewportIndex: 0 })).toMatchObject({ tab: '3d', isActive: true });
});

it('maps a pane the layout does not hold yet without throwing', () => {
  expect(mapStateToProps(state([]), { viewportIndex: 1 })).toMatchObject({ isActive: false });
});
