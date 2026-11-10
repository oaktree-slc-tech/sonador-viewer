// The `language` key of the `general` preference section, and whether the viewer applies it.
//
// The language selector is hidden (LANGUAGE_SELECTION_ENABLED) until the interface is translated:
// the bundled locales other than en-US hold a small part of its strings, and much of it renders
// English that never passes through i18n, so a choice changed almost nothing on screen. While it
// is hidden the viewer stays in its default language, and a language stored earlier is neither
// applied (nothing would let the user leave it) nor overwritten: a section POST replaces the
// section wholesale, so every write carries the stored value back as it was read -- from a write
// still queued, from hydration, or from the stored section read for the write -- and a write that
// can read none of them is not made.

import i18n from '@ohif/i18n';

import { LANGUAGE_SELECTION_ENABLED } from '../constants/preferences';

// The language the user's stored section holds, while it is not applied
let storedLanguage = null;

/** Apply a hydrated section's language, or keep it aside while the selector is hidden. */
export const applyStoredLanguage = (language, enabled = LANGUAGE_SELECTION_ENABLED) => {
  const valid = typeof language === 'string' && language ? language : null;
  storedLanguage = enabled ? null : valid;
  if (enabled && valid && valid !== i18n.language) {
    void i18n.changeLanguage(valid);
  }
};

/**
 * The value a write composed from the runtime holders carries for `language`: the stored one while
 * it is set aside, else the running language. It reflects the user's setting only once hydration
 * has landed; a write that cannot wait for that takes its base elsewhere (lib/generalPreferences.js).
 */
export const languagePreferenceValue = () => storedLanguage || i18n.language;

/** The language a Settings save writes as shown: only while the selector is offered. */
export const visibleLanguageValue = (enabled = LANGUAGE_SELECTION_ENABLED) => (enabled ? { language: i18n.language } : {});

export const resetLanguagePreferenceForTests = () => {
  storedLanguage = null;
};
