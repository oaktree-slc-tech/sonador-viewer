import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import i18n from '@ohif/i18n';
import { DownloadManagerService, DownloadManagerServiceEvents } from '@ohif/core';
import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';

import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
} from '../../../../constants/preferences';
import { useUpdateUserPreferenceSection } from '../../../../queries/preferences';
import { showSaveOutcome } from '../../../../components/UserPreferences/saveOutcomeNotification';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import styles from './GeneralTabNG.module.scss';

export default function GeneralTabNG() {
  // The preferences namespace, which is where every string on this surface is registered. Without
  // it i18next looks in the default namespace, finds nothing, and renders the key itself.
  const { t } = useTranslation('UserPreferencesModal');
  const { availableLanguages, language: currentLanguage } = i18n;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { isDesktop } = useDeviceStore();

  const selectedLanguage = availableLanguages.find(({ value }) => value === currentLanguage);

  const ref = useRef(null);
  const callback = useCallback(() => setIsDropdownOpen(false), [setIsDropdownOpen]);

  useClickOutside(ref, callback);

  const handleSelectLanguage = (language) => {
    i18n.changeLanguage(language.value);

    setIsDropdownOpen(false);
  };

  // Offline-storage transfer strategy (ohif-viewers#129, FR-1).
  //
  // This tab is the General preferences surface the application actually renders: the account menu
  // and the sidebar both route to /settings, and the legacy UserPreferences modal is not on that
  // path. Hydrated state lives on DownloadManagerService, which is where a starting job reads it.
  const [archiveTransfer, setArchiveTransfer] = useState(
    () => DownloadManagerService?.isArchiveTransferEnabled?.() ?? ARCHIVE_TRANSFER_DEFAULT
  );
  // Set once the user touches the checkbox, and never cleared: a late hydration must not reinstate
  // the old value after an edit OR after a save. Saving does not end the race -- the startup GET
  // that was already in flight can still land afterwards.
  const edited = useRef(false);

  // The initial read above can be too early. Preference hydration is an authenticated fetch kicked
  // off from a sibling effect, so opening /settings directly can render this form BEFORE the
  // stored value arrives: the checkbox would show the default, and saving would write that default
  // over what the user had stored. Following the service's own event keeps the form honest.
  useEffect(() => {
    if (!DownloadManagerService?.subscribe) {
      return undefined;
    }
    const { unsubscribe } = DownloadManagerService.subscribe(
      DownloadManagerServiceEvents.TRANSFER_MODE_CHANGED,
      ({ archiveTransferEnabled }) => {
        if (!edited.current) {
          setArchiveTransfer(archiveTransferEnabled);
        }
      }
    );
    return unsubscribe;
  }, []);

  const handleArchiveTransferChange = (event) => {
    edited.current = true;
    setArchiveTransfer(event.target.checked);
  };

  const { mutate: saveGeneralSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL);

  const onSave = () => {
    // Apply locally first, then sync through the write queue. `setArchiveTransferEnabled` records
    // this as an explicit choice, so hydration in flight can no longer override it in the service
    // either.
    DownloadManagerService?.setArchiveTransferEnabled?.(archiveTransfer);

    // `language` rides along because a section POST replaces the section's values wholesale --
    // sending the toggle alone would erase a stored language preference.
    saveGeneralSection(
      {
        version: PREFERENCES_VERSION,
        values: {
          language: i18n.language,
          [ARCHIVE_TRANSFER_PREFERENCE_KEY]: archiveTransfer,
        },
      },
      // Not the shared `SaveMessage` ("Preferences saved"): a confirmation that names the setting
      // and what it now does is worth more than one that says something was saved.
      showSaveOutcome(
        t('GeneralSettingsSaved'),
        'general preferences',
        t(archiveTransfer ? 'OfflineArchiveTransferSavedOn' : 'OfflineArchiveTransferSavedOff')
      )
    );
  };

  const onReset = () => {
    edited.current = true;
    setArchiveTransfer(ARCHIVE_TRANSFER_DEFAULT);
  };

  return (
    <>
      {isDesktop && <TabHeaderNG title="General Settings" />}
      <div className={styles.settings}>
        <div className={styles.wrapper}>
          <p className={styles.label}>{t('Language')}</p>
          <div className={styles.languagesContainer}>
            <button className={styles.selectedLanguage} onClick={() => setIsDropdownOpen((prevState) => !prevState)}>
              <span>{selectedLanguage?.label}</span>
              <CaretDownIcon
                className={classNames(styles.caretIcon, {
                  [styles.up]: isDropdownOpen,
                })}
              />
            </button>
            <div
              className={classNames(styles.languages, {
                [styles.displayed]: isDropdownOpen,
              })}
            >
              {availableLanguages.map((language) => {
                return (
                  <button key={language.value} onClick={() => handleSelectLanguage(language)} className={styles.language}>
                    {language.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Worded in transfer terms, never as "download an archive": this saves nothing to the
            user's computer -- the Downloads menu is what does that (#129 AR-6). */}
        <div className={classNames(styles.wrapper, styles.wrapperTop)}>
          <p className={styles.label}>{t('Offline storage')}</p>
          <div className={styles.optionContainer}>
            <label className={styles.option} htmlFor="offline-archive-transfer">
              <input
                id="offline-archive-transfer"
                type="checkbox"
                checked={archiveTransfer}
                onChange={handleArchiveTransferChange}
              />
              <span>{t('OfflineArchiveTransferLabel')}</span>
            </label>
            <p className={styles.optionHelp}>{t('OfflineArchiveTransferHelp')}</p>
          </div>
        </div>
      </div>

      <TabFooterNG onReset={onReset} onSave={onSave} hasErrors={false} />
    </>
  );
}
