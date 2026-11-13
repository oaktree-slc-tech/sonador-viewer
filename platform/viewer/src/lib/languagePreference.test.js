// The stored language while the selector is hidden, and once it is offered again

jest.mock('@ohif/i18n', () => ({ language: 'en-US', changeLanguage: jest.fn(function (l) { this.language = l; }) }));

const i18n = require('@ohif/i18n');
const { applyStoredLanguage, languagePreferenceValue, resetLanguagePreferenceForTests } = require('./languagePreference');

beforeEach(() => {
  resetLanguagePreferenceForTests();
  i18n.language = 'en-US';
  i18n.changeLanguage.mockClear();
});

describe('languagePreference', () => {
  it('is hidden by default: a stored language is kept for writes, not applied', () => {
    applyStoredLanguage('de');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(i18n.language).toBe('en-US');
    expect(languagePreferenceValue()).toBe('de');
  });

  it('writes the running language when nothing valid was stored', () => {
    applyStoredLanguage('de');
    applyStoredLanguage(undefined);
    expect(languagePreferenceValue()).toBe('en-US');
    applyStoredLanguage(7);
    expect(languagePreferenceValue()).toBe('en-US');
  });

  it('applies the stored language when the selector is offered', () => {
    applyStoredLanguage('de', true);
    expect(i18n.changeLanguage).toHaveBeenCalledWith('de');
    expect(languagePreferenceValue()).toBe('de');
    // A later change through i18n is what a write then carries
    i18n.language = 'fr';
    expect(languagePreferenceValue()).toBe('fr');
  });
});
