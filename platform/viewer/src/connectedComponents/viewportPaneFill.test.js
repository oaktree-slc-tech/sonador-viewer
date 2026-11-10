// Panes assigned when the viewer's display sets change: empty panes take the next display set,
// classic panes are refreshed with theirs, and panes of other views (MPR, 3D volume, segmentation
// editor) are left as they are, so adding a saved report's series keeps the MPR view.

import panesToFill, { panePlugin } from './viewportPaneFill';

const STUDY = '2.25.1001';
const ds = uid => ({ StudyInstanceUID: STUDY, displaySetInstanceUID: uid, plugin: 'cornerstone' });
const DISPLAY_SETS = [ds('ct'), ds('mr'), ds('sr')];
const shownIn = (uid, extra = {}) => ({ StudyInstanceUID: STUDY, displaySetInstanceUID: uid, ...extra });

it('leaves the panes of the MPR view as they are when a display set is added', () => {
  const layoutViewports = [0, 1, 2].map(() => ({ vtk: { mode: 'mpr', afterCreation: () => {} } }));
  const viewportSpecificData = { 0: shownIn('ct', { plugin: 'vtk' }), 1: shownIn('ct', { plugin: 'vtk' }), 2: shownIn('ct', { plugin: 'vtk' }) };
  expect(panesToFill({ layoutViewports, viewportSpecificData, displaySets: DISPLAY_SETS })).toEqual([]);
});

it('leaves a pane of another view as it is, by its layout plugin or its data plugin', () => {
  expect(panesToFill({
    layoutViewports: [{ plugin: 'viewer3dvolume' }, {}],
    viewportSpecificData: { 0: shownIn('ct'), 1: shownIn('mr', { plugin: 'seg3deditor' }) },
    displaySets: DISPLAY_SETS,
  })).toEqual([]);
});

it('refreshes classic panes with their display sets', () => {
  expect(panesToFill({
    layoutViewports: [{ plugin: 'cornerstone' }, {}],
    viewportSpecificData: { 0: shownIn('ct', { plugin: 'cornerstone' }), 1: shownIn('mr') },
    displaySets: DISPLAY_SETS,
  })).toEqual([
    { viewportIndex: 0, StudyInstanceUID: STUDY, displaySetInstanceUID: 'ct' },
    { viewportIndex: 1, StudyInstanceUID: STUDY, displaySetInstanceUID: 'mr' },
  ]);
});

it('gives an empty pane the next display set not shown, also beside a kept pane', () => {
  expect(panesToFill({
    layoutViewports: [{ vtk: { mode: 'mpr' } }, {}],
    viewportSpecificData: { 0: shownIn('ct', { plugin: 'vtk' }) },
    displaySets: DISPLAY_SETS,
  })).toEqual([{ viewportIndex: 1, StudyInstanceUID: STUDY, displaySetInstanceUID: 'mr' }]);
});

it('gives empty panes the last display set when every one is shown, and assigns nothing without display sets', () => {
  expect(panesToFill({ layoutViewports: [{}, {}], viewportSpecificData: {}, displaySets: [ds('ct')] }))
    .toEqual([
      { viewportIndex: 0, StudyInstanceUID: STUDY, displaySetInstanceUID: 'ct' },
      { viewportIndex: 1, StudyInstanceUID: STUDY, displaySetInstanceUID: 'ct' },
    ]);
  expect(panesToFill({ layoutViewports: [{}], viewportSpecificData: {}, displaySets: [] })).toEqual([]);
});

it('reads the plugin of a pane from its layout entry first, then its data, else the classic one', () => {
  expect(panePlugin({ vtk: { mode: 'mpr' } }, { plugin: 'cornerstone' })).toBe('vtk');
  expect(panePlugin({ plugin: 'cornerstone' }, { plugin: 'vtk' })).toBe('cornerstone');
  expect(panePlugin({}, { plugin: 'vtk' })).toBe('vtk');
  expect(panePlugin(undefined, undefined)).toBe('cornerstone');
});
