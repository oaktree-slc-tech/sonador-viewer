// Image references in naturalized SR content: object or array sequences, own or nested

import { findReferencedSOP, findReferencedSOPSequence } from './findReferencedSOP';

const image = sop => ({ ValueType: 'IMAGE', ReferencedSOPSequence: { ReferencedSOPInstanceUID: sop, ReferencedFrameNumber: 2 } });

describe('findReferencedSOPSequence', () => {
  it('reads an object or array sequence, on the item or on a child item', () => {
    expect(findReferencedSOPSequence({ ReferencedSOPSequence: { ReferencedSOPInstanceUID: 'a' } }).ReferencedSOPInstanceUID).toBe('a');
    expect(findReferencedSOPSequence({ ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'b' }] }).ReferencedSOPInstanceUID).toBe('b');
    expect(findReferencedSOPSequence({ ContentSequence: image('c') }).ReferencedSOPInstanceUID).toBe('c');
    expect(findReferencedSOPSequence({ ContentSequence: [{ ValueType: 'TEXT' }, image('d')] }).ReferencedSOPInstanceUID).toBe('d');
    expect(findReferencedSOPSequence({ ContentSequence: [{ ValueType: 'TEXT' }] })).toBeUndefined();
    expect(findReferencedSOPSequence(undefined)).toBeUndefined();
  });
});

describe('findReferencedSOP', () => {
  const finding = (ref) => ({ kind: 'finding', ...(ref ? { ContentSequence: image(ref) } : {}) });

  it('prefers the items the predicate selects, then falls back to any item', () => {
    const items = [{ kind: 'text', ContentSequence: image('other') }, finding(undefined), finding('tag')];
    const found = findReferencedSOP(items, item => item.kind === 'finding');
    expect(found).toMatchObject({ ReferencedSOPInstanceUID: 'tag', ReferencedFrameNumber: 2 });
    expect(found.ReferencedSOPSequence.ReferencedSOPInstanceUID).toBe('tag');

    expect(findReferencedSOP([finding(undefined), { kind: 'text', ContentSequence: image('other') }], item => item.kind === 'finding')
      .ReferencedSOPInstanceUID).toBe('other');
    expect(findReferencedSOP([finding(undefined)], item => item.kind === 'finding')).toBeUndefined();
  });
});
