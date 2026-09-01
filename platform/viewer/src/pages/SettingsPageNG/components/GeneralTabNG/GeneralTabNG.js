import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import i18n from '@ohif/i18n';
import {
  DownloadManagerService,
  DownloadManagerServiceEvents,
  RETRY_ATTEMPTS_DEFAULT,
  RETRY_ATTEMPTS_MAX,
  RETRY_ATTEMPTS_MIN,
} from '@ohif/core';
import { Numeric } from '@ohif/ui-next';
import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';

import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  PREFERENCES_VERSION,
  PREFERENCE_SECTIONS,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
} from '../../../../constants/preferences';
import { createHydrationLatch } from '../../../../lib/preferenceHydration';
import { useUpdateUserPreferenceSection } from '../../../../queries/preferences';
import { showSaveOutcome } from '../../../../components/UserPreferences/saveOutcomeNotification';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import styles from './GeneralTabNG.module.scss';

// Latch keys for the two offline-storage fields on this tab.
const ARCHIVE_FIELD = 'archiveTransfer';
const RETRY_FIELD = 'retryAttempts';

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
  // Which fields the user has changed. Per FIELD, not per form: the section is saved wholesale, so
  // one shared flag would let an edit to either control block hydration of the other and then post
  // that other field's default over the value already stored. Never cleared by saving -- the
  // startup GET that was already in flight can still land afterwards.
  const latch = useRef(createHydrationLatch()).current;

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
      ({ archiveTransferEnabled }) =>
        setArchiveTransfer(current => latch.accept(ARCHIVE_FIELD, archiveTransferEnabled, current))
    );
    return unsubscribe;
  }, []);

  const handleArchiveTransferChange = (event) => {
    latch.markEdited(ARCHIVE_FIELD);
    setArchiveTransfer(event.target.checked);
  };

  // Per-instance attempt budget (ohif-viewers#131, FR-12). Same shape as the toggle above: read
  // from the service, follow its hydration event until the user touches the control, and apply
  // locally before syncing. Held as a number -- Numeric keeps it inside min/max and ignores a
  // partially typed value, so the form never holds something unusable.
  const [retryAttempts, setRetryAttempts] = useState(
    () => DownloadManagerService?.getRetryAttempts?.() ?? RETRY_ATTEMPTS_DEFAULT
  );

  useEffect(() => {
    if (!DownloadManagerService?.subscribe) {
      return undefined;
    }
    const { unsubscribe } = DownloadManagerService.subscribe(
      DownloadManagerServiceEvents.RETRY_ATTEMPTS_CHANGED,
      ({ retryAttempts: hydrated }) =>
        setRetryAttempts(current => latch.accept(RETRY_FIELD, hydrated, current))
    );
    return unsubscribe;
  }, []);

  const handleRetryAttemptsChange = (value) => {
    latch.markEdited(RETRY_FIELD);
    setRetryAttempts(value);
  };

  const stepRetryAttempts = useCallback(
    (delta) => {
      latch.markEdited(RETRY_FIELD);
      setRetryAttempts((current) =>
        Math.min(RETRY_ATTEMPTS_MAX, Math.max(RETRY_ATTEMPTS_MIN, current + delta))
      );
    },
    [latch]
  );

  // Numeric binds no keyboard events -- neither does the upstream component ours was ported from --
  // so a control that looks like a spinner ignores Up and Down. Bound here, at the point of use,
  // rather than by diverging our copy of a shared ui-next component from upstream.
  //
  // Attached to the rendered input rather than to the wrapping label: the label is not an
  // interactive element, and delegating from it would also fire while a chevron button held focus.
  // The functional state update is what keeps this listener correct without rebinding on
  // every value change.
  const retryFieldRef = useRef(null);

  useEffect(() => {
    const input = retryFieldRef.current?.querySelector('input');
    if (!input) {
      return undefined;
    }

    const onKeyDown = (event) => {
      const delta = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (!delta) {
        return;
      }
      // Also stops the key from scrolling the settings panel.
      event.preventDefault();
      stepRetryAttempts(delta);
    };

    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, [stepRetryAttempts]);

  const { mutate: saveGeneralSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL);

  const onSave = () => {
    // Apply locally first, then sync through the write queue. `setArchiveTransferEnabled` records
    // this as an explicit choice, so hydration in flight can no longer override it in the service
    // either.
    DownloadManagerService?.setArchiveTransferEnabled?.(archiveTransfer);
    DownloadManagerService?.setRetryAttempts?.(retryAttempts);

    // `language` rides along because a section POST replaces the section's values wholesale --
    // sending the toggle alone would erase a stored language preference.
    saveGeneralSection(
      {
        version: PREFERENCES_VERSION,
        values: {
          language: i18n.language,
          [ARCHIVE_TRANSFER_PREFERENCE_KEY]: archiveTransfer,
          [RETRY_ATTEMPTS_PREFERENCE_KEY]: retryAttempts,
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
    latch.markEdited(ARCHIVE_FIELD);
    latch.markEdited(RETRY_FIELD);
    setArchiveTransfer(ARCHIVE_TRANSFER_DEFAULT);
    setRetryAttempts(RETRY_ATTEMPTS_DEFAULT);
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

            {/* Attempt budget (ohif-viewers#131, FR-12). Sits under the transfer strategy because
                both describe how an offline copy is fetched, and neither affects a transfer
                already in progress.

                `Numeric` is the ui-next stepper, so this control looks and behaves like every
                other numeric input in the application rather than like a one-off. No Tailwind
                classes are passed to it: the @source list in ui-next's tailwind-integration.css
                does not cover platform/viewer/src, so utility classes named from here are never
                generated. The stepper's own defaults are used instead.

                The `label` wraps the control rather than pointing at it with `htmlFor`, because
                Numeric renders its own input and gives it no id. In the vertical stepper the input
                is the first labelable descendant, so the implicit association lands on it and not
                on the increment buttons. */}
            <label
              className={classNames(styles.option, styles.optionNumeric)}
              ref={retryFieldRef}
            >
              <Numeric.Container
                mode="stepper"
                min={RETRY_ATTEMPTS_MIN}
                max={RETRY_ATTEMPTS_MAX}
                step={1}
                value={retryAttempts}
                onChange={handleRetryAttemptsChange}
              >
                <Numeric.NumberStepper />
              </Numeric.Container>
              <span>{t('OfflineRetryAttemptsLabel')}</span>
            </label>
            <p className={styles.optionHelp}>{t('OfflineRetryAttemptsHelp')}</p>
          </div>
        </div>
      </div>

      <TabFooterNG onReset={onReset} onSave={onSave} hasErrors={false} />
    </>
  );
}
