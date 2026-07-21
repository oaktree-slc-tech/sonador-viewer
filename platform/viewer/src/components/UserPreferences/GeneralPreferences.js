import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import i18n from '@ohif/i18n';
import { LanguageSwitcher, TabFooter, useSnackbarContext } from '@ohif/ui';

import { PREFERENCES_VERSION, PREFERENCE_SECTIONS } from '../../constants/preferences';
import { useUpdateUserPreferenceSection } from '../../queries/preferences';

import { showSaveOutcome } from './saveOutcomeNotification';

import './GeneralPreferences.styl';

/**
 * General Preferences tab
 * It renders the General Preferences content
 *
 * @param {object} props component props
 * @param {function} props.onClose
 */
function GeneralPreferences({ onClose }) {
  const { t } = useTranslation('UserPreferencesModal');
  const snackbar = useSnackbarContext();
  const currentLanguage = i18n.language;
  const { availableLanguages } = i18n;

  const [language, setLanguage] = useState(currentLanguage);

  const onResetPreferences = () => {
    setLanguage(i18n.defaultLanguage);
  };

  const { mutate: saveGeneralSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL);

  const onSave = () => {
    // Local application first (AR-5): i18n keeps its own detection cache as the fallback.
    i18n.changeLanguage(language);

    // Cloud sync through the write queue (FR-7).
    saveGeneralSection(
      { version: PREFERENCES_VERSION, values: { language } },
      showSaveOutcome(snackbar, t('SaveMessage'), 'general preferences')
    );

    onClose();
  };

  const hasErrors = false;

  return (
    <React.Fragment>
      <div className="GeneralPreferences">
        <div className="language">
          <label htmlFor="language-select" className="languageLabel">
            Language
          </label>
          <LanguageSwitcher language={language} onLanguageChange={setLanguage} languages={availableLanguages} />
        </div>
      </div>
      <TabFooter
        onResetPreferences={onResetPreferences}
        onSave={onSave}
        onCancel={onClose}
        hasErrors={hasErrors}
        t={t}
      />
    </React.Fragment>
  );
}

GeneralPreferences.propTypes = {
  onClose: PropTypes.func,
};

export { GeneralPreferences };
