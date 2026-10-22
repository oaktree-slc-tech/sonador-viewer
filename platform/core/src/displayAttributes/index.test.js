import {
  SERIES_TAG_TOOL,
  normalizeHexColor,
  normalizeColor,
  getDisplayColor,
  resolveDisplayColor,
  resolveFindingColor,
  resolveDisplayAttributes,
  setSiteDisplayAttributes,
  subscribeSiteDisplayAttributes,
  hexToDicomLab,
  dicomLabToHex,
} from './index';

afterEach(() => setSiteDisplayAttributes(null));

describe('normalizeHexColor', () => {
  it('returns upper-case #RRGGBB', () => {
    expect(normalizeHexColor('#8ad0a8')).toBe('#8AD0A8');
    expect(normalizeHexColor(' #0a0 ')).toBe('#00AA00');
  });

  it.each(['8AD0A8', '#8AD0A', 'green', '#8AD0A8FF', null, undefined, 12])('rejects %p', value => {
    expect(normalizeHexColor(value)).toBeNull();
  });

  it('drops unknown roles and invalid colors', () => {
    expect(normalizeColor({ Value: '#abc', Meaning: 'red', Border: '#fff', Outline: '#FFFFFF' })).toEqual({ Value: '#AABBCC', Border: '#FFFFFF' });
  });
});

describe('getDisplayColor', () => {
  it('reads tag Meta documents, payloads and measurements', () => {
    const color = { Value: '#FF0000' };
    expect(getDisplayColor({ DisplayAttributes: { Color: color } })).toEqual(color);
    expect(getDisplayColor({ displayAttributes: { Color: color } })).toEqual(color);
    expect(getDisplayColor({ Color: color })).toEqual(color);
    expect(getDisplayColor(undefined)).toEqual({});
  });
});

describe('resolveDisplayColor', () => {
  it('falls back to the built-in profile', () => {
    expect(resolveDisplayColor(SERIES_TAG_TOOL)).toEqual({ Background: null, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' });
  });

  it('prefers the site defaults over the built-in profile', () => {
    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Background: '#000000', Meaning: '#FFFFFF' } } });
    expect(resolveDisplayColor(SERIES_TAG_TOOL)).toEqual({ Background: '#000000', Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#FFFFFF' });
  });

  it('prefers the tag over the site and colors the meaning with the tag value when unset', () => {
    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Meaning: '#FFFFFF' } } });
    expect(resolveDisplayColor(SERIES_TAG_TOOL, { Value: '#FF0000' })).toEqual({ Background: null, Border: '#FFFFFF', Value: '#FF0000', Meaning: '#FF0000' });
    expect(resolveDisplayColor(SERIES_TAG_TOOL, { Background: '#123456' })).toEqual({ Background: '#123456', Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#FFFFFF' });
  });

  it('applies the meaning fallback to tag levels only', () => {
    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Value: '#00FF00', Meaning: null } } });
    expect(resolveDisplayColor(SERIES_TAG_TOOL)).toEqual({ Background: null, Border: '#FFFFFF', Value: '#00FF00', Meaning: '#C0C7F8' });
  });

  it('builds the measurement payload from a tag Meta document', () => {
    expect(resolveDisplayAttributes(SERIES_TAG_TOOL, { DisplayAttributes: { Color: { Background: '#fff' } } }))
      .toEqual({ Color: { Background: '#FFFFFF', Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' } });
  });

  it('resolves the border from the tag, then the site, then white', () => {
    expect(resolveDisplayColor(SERIES_TAG_TOOL).Border).toBe('#FFFFFF');
    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Border: '#123456' } } });
    expect(resolveDisplayColor(SERIES_TAG_TOOL).Border).toBe('#123456');
    expect(resolveDisplayColor(SERIES_TAG_TOOL, { Border: '#ABCDEF' }).Border).toBe('#ABCDEF');
  });

  it('keeps a saved finding background, including no fill, when the site defaults change', () => {
    const transparent = { displayAttributes: resolveDisplayAttributes(SERIES_TAG_TOOL, null) };
    const opaque = { displayAttributes: resolveDisplayAttributes(SERIES_TAG_TOOL, { DisplayAttributes: { Color: { Background: '#123456' } } }) };

    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Background: '#FFFFFF', Border: '#FFFFFF', Value: '#000000' } } });
    expect(resolveFindingColor(SERIES_TAG_TOOL, transparent)).toEqual({ Background: null, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' });
    expect(resolveFindingColor(SERIES_TAG_TOOL, opaque).Background).toBe('#123456');

    // A finding saved before display attributes existed follows the current defaults
    expect(resolveFindingColor(SERIES_TAG_TOOL, {})).toEqual({ Background: '#FFFFFF', Border: '#FFFFFF', Value: '#000000', Meaning: '#C0C7F8' });
  });

  it('notifies subscribers when the site defaults change', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSiteDisplayAttributes(listener);
    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Value: '#ABCDEF' } } });
    unsubscribe();
    setSiteDisplayAttributes(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({ [SERIES_TAG_TOOL]: { Color: { Value: '#ABCDEF' } } });
  });
});

describe('DICOM CIELab conversion', () => {
  it('round-trips colors exactly', () => {
    const colors = ['#000000', '#FFFFFF', '#8AD0A8', '#C0C7F8', '#348CFD', '#5ACCE6', '#FF0000', '#00FF00', '#0000FF', '#010203'];
    for (let i = 0; i < 2000; i++) {
      colors.push(`#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`);
    }
    colors.forEach(hex => expect(dicomLabToHex(hexToDicomLab(hex))).toBe(hex));
  });

  it('accepts the L\\a\\b string form and rejects invalid triples', () => {
    expect(dicomLabToHex(hexToDicomLab('#8AD0A8').join('\\'))).toBe('#8AD0A8');
    expect(dicomLabToHex('1\\2')).toBeNull();
    expect(dicomLabToHex('1\\2\\70000')).toBeNull();
    expect(dicomLabToHex('a\\b\\c')).toBeNull();
    expect(hexToDicomLab('green')).toBeNull();
  });

  it('encodes white as maximum lightness on the neutral axis', () => {
    const [L, a, b] = hexToDicomLab('#FFFFFF');
    expect(L).toBeGreaterThanOrEqual(65530);
    expect(Math.abs(a - 32896)).toBeLessThan(5);
    expect(Math.abs(b - 32896)).toBeLessThan(5);
  });
});
