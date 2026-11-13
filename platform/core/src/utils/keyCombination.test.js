import { canonicalKeyCombination } from './keyCombination';

describe('canonicalKeyCombination', () => {
  it('does not depend on the order or the case of the modifiers', () => {
    expect(canonicalKeyCombination(['shift', 'Ctrl', 'z'])).toBe('ctrl+shift+z');
    expect(canonicalKeyCombination(['ctrl', 'shift', 'z'])).toBe('ctrl+shift+z');
    expect(canonicalKeyCombination(['a'])).toBe('a');
    expect(canonicalKeyCombination(['ctrl', '+'])).toBe('ctrl++');
  });

  it('tells Ctrl and Cmd apart unless asked to count them as one', () => {
    expect(canonicalKeyCombination(['meta', 'z'])).toBe('meta+z');
    expect(canonicalKeyCombination(['command', 'z'])).toBe('meta+z');
    expect(canonicalKeyCombination(['meta', 'z'])).not.toBe(canonicalKeyCombination(['ctrl', 'z']));
    expect(canonicalKeyCombination(['meta', 'z'], { ctrlMatchesMeta: true })).toBe('ctrl+z');
    expect(canonicalKeyCombination(['z', 'meta'], { ctrlMatchesMeta: true })).toBe('ctrl+z');
    expect(canonicalKeyCombination(['mod', 'shift', 'z'], { ctrlMatchesMeta: true })).toBe('ctrl+shift+z');
    expect(canonicalKeyCombination(['option', 'x'])).toBe('alt+x');
  });

  it('gives an empty key for a combination of modifiers only, or none', () => {
    expect(canonicalKeyCombination(['ctrl'])).toBe('ctrl+');
    expect(canonicalKeyCombination()).toBe('');
  });
});
