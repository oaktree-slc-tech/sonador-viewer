// "Apply search to views": the annotations a search leaves out are hidden in the views, only if
// they were shown, and shown again when they match again, the search is cleared or the setting
// is turned off; one the user hid stays hidden.

import reconcileSearchVisibility from './searchVisibility';

const rows = [
  { measurementId: 'a', isVisible: true },
  { measurementId: 'b', isVisible: true },
  { measurementId: 'c', isVisible: false },
];

it('hides the shown annotations the search leaves out, not one the user hid', () => {
  const result = reconcileSearchVisibility({ rows, matching: new Set(['a']), active: true, hiddenBySearch: new Set() });
  expect(result.hide).toEqual(['b']);
  expect(result.show).toEqual([]);
  expect([...result.hiddenBySearch]).toEqual(['b']);
});

it('shows an annotation again when it matches again, and keeps hidden what still does not match', () => {
  const after = rows.map(row => (row.measurementId === 'b' ? { ...row, isVisible: false } : row));
  const result = reconcileSearchVisibility({ rows: after, matching: new Set(['b']), active: true, hiddenBySearch: new Set(['b']) });
  expect(result.show).toEqual(['b']);
  expect(result.hide).toEqual(['a']);
  expect([...result.hiddenBySearch]).toEqual(['a']);
});

it('shows everything it hid when the search or the setting is cleared, and forgets removed rows', () => {
  const result = reconcileSearchVisibility({ rows, matching: new Set(), active: false, hiddenBySearch: new Set(['b', 'gone']) });
  expect(result.show).toEqual(['b']);
  expect(result.hide).toEqual([]);
  expect(result.hiddenBySearch.size).toBe(0);
});
