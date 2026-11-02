import { firstDefinedValue, firstPresentValue } from './dataProc';

describe('dataProc', () => {
  it('firstDefinedValue skips undefined and null', () => {
    expect(firstDefinedValue(undefined, null, '0.2')).toBe('0.2');
    expect(firstDefinedValue(undefined, null)).toBeUndefined();
  });

  it('firstPresentValue skips only undefined, so an explicit null wins over later values', () => {
    expect(firstPresentValue(undefined, '0.2')).toBe('0.2');
    expect(firstPresentValue(null, '0.2')).toBeNull();
    expect(firstPresentValue('', '0.2')).toBe('');
    expect(firstPresentValue(undefined, undefined)).toBeUndefined();
  });
});
