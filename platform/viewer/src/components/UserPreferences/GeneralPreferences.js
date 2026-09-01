import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import i18n from '@ohif/i18n';
import { DownloadManagerService, RETRY_ATTEMPTS_DEFAULT } from '@ohif/core';
import { LanguageSwitcher, TabFooter } from '@ohif/ui';

import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
} from '../../constants/preferences';
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
  const currentLanguage = i18n.language;
  const { availableLanguages } = i18n;

  const [language, setLanguage] = useState(currentLanguage);
  // Read from the service, which is where the hydrated preference lives (ohif-viewers#129, FR-1).
  const [archiveTransfer, setArchiveTransfer] = useState(
    () => DownloadManagerService?.isArchiveTransferEnabled?.() ?? ARCHIVE_TRANSFER_DEFAULT
  );

  const onResetPreferences = () => {
    setLanguage(i18n.defaultLanguage);
    setArchiveTransfer(ARCHIVE_TRANSFER_DEFAULT);
  };

  const { mutate: saveGeneralSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL);

  const onSave = () => {
    // Local application first (AR-5): i18n keeps its own detection cache as the fallback, and the
    // download queue reads its transfer mode from the service when a job starts.
    i18n.changeLanguage(language);
    DownloadManagerService?.setArchiveTransferEnabled?.(archiveTransfer);

    // Cloud sync through the write queue (FR-7).
    saveGeneralSection(
      {
        version: PREFERENCES_VERSION,
        values: {
          language,
          [ARCHIVE_TRANSFER_PREFERENCE_KEY]: archiveTransfer,
          // Carried, not edited: this legacy modal has no control for the attempt budget, but a
          // section POST replaces the section wholesale, so omitting the key would erase whatever
          // the Settings page stored (ohif-viewers#131 FR-12).
          [RETRY_ATTEMPTS_PREFERENCE_KEY]:
            DownloadManagerService?.getRetryAttempts?.() ?? RETRY_ATTEMPTS_DEFAULT,
        },
      },
      showSaveOutcome(t('SaveMessage'), 'general preferences')
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

        {/* Offline-storage transfer strategy (ohif-viewers#129, FR-1). Worded in transfer terms
            rather than implementation terms, and deliberately NOT as "download an archive" — this
            saves nothing to the user's computer; the Downloads menu is what does that (AR-6). */}
        <div className="offlineTransfer">
          <label className="offlineTransferLabel" htmlFor="offline-archive-transfer">
            Offline storage
          </label>
          <div className="offlineTransferControl">
            <div className="offlineTransferOption">
              <input
                id="offline-archive-transfer"
                type="checkbox"
                checked={archiveTransfer}
                onChange={event => setArchiveTransfer(event.target.checked)}
              />
              <span>Transfer offline copies as per-series archives</span>
            </div>
            <p className="offlineTransferHelp">
              Fetches one compressed archive per series instead of one request per image. This is
              usually much faster over slow or high-latency connections. The copy stored on this
              device is the same either way.
            </p>
          </div>
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
