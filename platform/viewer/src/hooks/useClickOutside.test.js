import { isOutside } from './useClickOutside';

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
