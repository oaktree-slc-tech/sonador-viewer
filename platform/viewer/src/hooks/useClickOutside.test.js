import { isOutside, refNodes } from './useClickOutside';

const node = (inside = []) => ({ contains: target => inside.includes(target) });

describe('isOutside', () => {
  it('is false for a target inside any of the nodes', () => {
    const target = {};

    expect(isOutside(target, [node([target])])).toBe(false);
    expect(isOutside(target, [node(), node([target])])).toBe(false);
  });

  it('is true for a target outside every node, ignoring missing refs', () => {
    expect(isOutside({}, [node(), null, undefined])).toBe(true);
  });

  it('is false without a target', () => {
    expect(isOutside(null, [node()])).toBe(false);
  });
});

describe('refNodes', () => {
  it('reads a single ref', () => {
    const el = {};

    expect(refNodes({ current: el })).toEqual([el]);
  });

  it('reads every ref in an array, so a portalled menu counts as inside', () => {
    const trigger = {};
    const menu = {};
    const target = {};

    expect(refNodes([{ current: trigger }, { current: menu }])).toEqual([trigger, menu]);
    expect(isOutside(target, refNodes([{ current: node() }, { current: node([target]) }]))).toBe(false);
  });
});
