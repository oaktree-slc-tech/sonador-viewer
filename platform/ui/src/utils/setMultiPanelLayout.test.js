// The multi-panel layout shows a copy of the display set tagged with the view's plugin, so the
// caller's display set (possibly the study's own) is left as it was and later shows of the series
// are not opened in that view.

jest.mock('./setLayoutAndViewportData.js', () => jest.fn());

import setLayoutAndViewportData from './setLayoutAndViewportData.js';
import setMultiPanelLayout from './setMultiPanelLayout.js';

class StudyDisplaySet {
  constructor() {
    this.displaySetInstanceUID = 'ds-1';
    this.SeriesInstanceUID = '2.25.2';
    this.plugin = 'cornerstone';
  }

  getSourceDisplaySet() {
    return this.displaySetInstanceUID;
  }
}

beforeEach(() => setLayoutAndViewportData.mockClear());

it("shows a copy of the display set tagged with the view's plugin, leaving the caller's as it was", () => {
  const displaySet = new StudyDisplaySet();
  setMultiPanelLayout(displaySet, [{}, {}, {}], 1, 3, 'vtk', 'mpr');

  expect(displaySet.plugin).toBe('cornerstone');
  const [layout, viewportSpecificData] = setLayoutAndViewportData.mock.calls[0];
  expect(layout).toMatchObject({ numRows: 1, numColumns: 3 });
  expect(layout.viewports.map(viewport => viewport.vtk.mode)).toEqual(['mpr', 'mpr', 'mpr']);
  [0, 1, 2].forEach((index) => {
    const shown = viewportSpecificData[index];
    expect(shown).not.toBe(displaySet);
    expect(shown).toMatchObject({ displaySetInstanceUID: 'ds-1', SeriesInstanceUID: '2.25.2', plugin: 'vtk' });
    expect(shown.getSourceDisplaySet()).toBe('ds-1');
  });
});
