jest.mock('@ohif/ui/src/components/ModalNG/ModalNG', () => () => null);
jest.mock('react-color', () => ({ ChromePicker: () => null }));
jest.mock('@ohif/core', () => ({
  displayAttributes: jest.requireActual('../../../../core/src/displayAttributes'),
}));

const { paletteFor, THEME_PALETTE } = require('./DisplayAttributesDialog');
const { displayAttributes } = require('@ohif/core');

describe('paletteFor', () => {
  it('offers the built-in defaults first, then the theme colors', () => {
    const palette = paletteFor(displayAttributes.resolveDisplayColor(displayAttributes.SERIES_TAG_TOOL));
    expect(palette.slice(0, 2).map(s => s.hex)).toEqual(['#8AD0A8', '#C0C7F8']);
    expect(palette.slice(2).map(s => s.hex)).toEqual(THEME_PALETTE.map(s => s.hex));
  });

  it('adds site defaults that differ from the built-in profile once', () => {
    const palette = paletteFor({ Background: '#123456', Value: '#8AD0A8', Meaning: '#FFFFFF' });
    expect(palette.filter(s => s.hex === '#123456')).toHaveLength(1);
    expect(palette.filter(s => s.hex === '#8AD0A8')).toHaveLength(1);
    expect(palette.filter(s => s.hex === '#FFFFFF')).toHaveLength(1);
  });
});
