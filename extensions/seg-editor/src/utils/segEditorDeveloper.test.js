/**
 * @jest-environment jsdom
 */
import { isDeveloperToolsEnabled } from './segEditorDeveloper';

describe('isDeveloperToolsEnabled', () => {
  it('is off unless the app config says so, exactly', () => {
    expect(isDeveloperToolsEnabled(undefined)).toBe(false);
    expect(isDeveloperToolsEnabled({})).toBe(false);
    expect(isDeveloperToolsEnabled({ segEditor: {} })).toBe(false);
    expect(isDeveloperToolsEnabled({ segEditor: { developerTools: 'yes' } })).toBe(false);
    expect(isDeveloperToolsEnabled({ segEditor: { developerTools: true } })).toBe(true);
  });

  it('reads window.config by default', () => {
    const previous = window.config;
    window.config = { segEditor: { developerTools: true } };
    expect(isDeveloperToolsEnabled()).toBe(true);
    window.config = previous;
    expect(isDeveloperToolsEnabled()).toBe(false);
  });
});
