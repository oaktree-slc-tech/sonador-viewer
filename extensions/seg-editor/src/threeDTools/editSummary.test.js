// The Selection panel's edit summary line

import { editSummary } from './editSummary';

const t = (key, options = {}) => key.replace(/{{(\w+)}}/g, (_m, name) => options[name]);

describe('editSummary', () => {
  it('describes a removal: points, holes and how they were closed, and the result', () => {
    expect(editSummary(t, { points: 312, holes: 2, methods: { fitted: 1, flat: 1 }, closed: true }))
      .toBe('312 point(s) removed, 2 hole(s) closed (1 smooth, 1 flat); result closed');
  });

  it('describes a repair, and open edges that could not be closed', () => {
    expect(editSummary(t, { repair: true, holes: 1, methods: { flat: 1 }, openEdges: 4, closed: false }))
      .toBe('1 open rim(s) closed (1 flat); 4 edge(s) could not be closed; result still open');
  });

  it('leaves the result out when it is unknown', () => {
    expect(editSummary(t, { points: 3, holes: 0 })).toBe('3 point(s) removed, 0 hole(s) closed');
  });

  it('describes a smooth by the points it moved', () => {
    expect(editSummary(t, { kind: 'smooth', points: 120 })).toBe('120 point(s) smoothed');
  });
});
