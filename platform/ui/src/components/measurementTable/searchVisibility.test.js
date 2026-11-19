// "Apply search to views": the rows the search leaves out are reported to the session's visibility
// rule (through the Measurements API), which hides them in the views beside the user's own choices
// and the active timepoint; nothing is reported while the setting is off or no search is active.

import reconcileSearchVisibility from './searchVisibility';

const rows = [
  { measurementId: 'a', isVisible: true },
  { measurementId: 'b', isVisible: true },
  { measurementId: 'c', isVisible: false },
];

it('reports the rows the search leaves out, whatever their visibility', () => {
  const result = reconcileSearchVisibility({ rows, matching: new Set(['a']), active: true });
  expect([...result.hiddenBySearch].sort()).toEqual(['b', 'c']);
});

it('reports nothing while the search does not apply to the views', () => {
  expect(reconcileSearchVisibility({ rows, matching: new Set(['a']), active: false }).hiddenBySearch.size).toBe(0);
  expect(reconcileSearchVisibility({ rows: [], matching: new Set(), active: true }).hiddenBySearch.size).toBe(0);
});

it('leaves out rows without a key', () => {
  const result = reconcileSearchVisibility({ rows: [...rows, { label: 'no key' }, null], matching: new Set(), active: true });
  expect([...result.hiddenBySearch].sort()).toEqual(['a', 'b', 'c']);
});
