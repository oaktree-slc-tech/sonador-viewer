// Settings > General > Application: the language, how studies are opened, the offline-storage
// transfer settings and the upload attempt budget, on the settings page's row anatomy
// (SettingRowNG). Presentational: the state, hydration and Save are GeneralTabNG's; the language is
// i18n's own and changes at once, as it always has. The language row is not offered while
// LANGUAGE_SELECTION_ENABLED is off (constants/preferences): the other locales translate too little
// of the interface for a choice to change what is on screen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { RETRY_ATTEMPTS_MAX, RETRY_ATTEMPTS_MIN, UPLOAD_ATTEMPTS_MAX, UPLOAD_ATTEMPTS_MIN } from '@ohif/core';
import i18n from '@ohif/i18n';
import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { Numeric } from '@ohif/ui-next';

import { LANGUAGE_SELECTION_ENABLED } from '../../../../constants/preferences';
import SettingRowNG, { NumericRowNG, SwitchRowNG } from '../SettingRowNG/SettingRowNG';

import styles from './GeneralTabNG.module.scss';

// Numeric binds no keyboard events -- neither does the upstream component ours was ported from --
// so a control that looks like a spinner ignores Up and Down. Bound here, at the point of use,
// rather than by diverging our copy of a shared ui-next component from upstream. Bound in this tab
// rather than the page because the tab's content is unmounted while the other tab is shown, and the
// input is a new element each time it comes back.
//
// Attached to the rendered input rather than to the wrapping label: the label is not an
// interactive element, and delegating from it would also fire while a chevron button held focus.
function useArrowKeyStepping(fieldRef, onStep) {
  useEffect(() => {
    const input = fieldRef.current?.querySelector('input');
    if (!input) {
      return undefined;
    }
    const onKeyDown = event => {
      const delta = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (!delta) {
        return;
      }
      // Also stops the key from scrolling the settings panel.
      event.preventDefault();
      onStep(delta);
    };
    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, [fieldRef, onStep]);
}

export default function ApplicationSettingsTab({
  archiveTransfer, onArchiveTransferChange, retryAttempts, onRetryAttemptsChange, onStepRetryAttempts,
  studyArchiveLoading, onStudyArchiveLoadingChange, studyArchiveLoadingSupported = true,
  uploadAttempts, onUploadAttemptsChange, onStepUploadAttempts,
  languageSelection = LANGUAGE_SELECTION_ENABLED,
}) {
  const { t } = useTranslation('UserPreferencesModal');
  const { availableLanguages, language: currentLanguage } = i18n;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedLanguage = availableLanguages.find(({ value }) => value === currentLanguage);

  const ref = useRef(null);
  const callback = useCallback(() => setIsDropdownOpen(false), [setIsDropdownOpen]);
  useClickOutside(ref, callback);

  const handleSelectLanguage = language => {
    i18n.changeLanguage(language.value);
    setIsDropdownOpen(false);
  };

  const retryFieldRef = useRef(null);
  useArrowKeyStepping(retryFieldRef, onStepRetryAttempts);
  const uploadFieldRef = useRef(null);
  useArrowKeyStepping(uploadFieldRef, onStepUploadAttempts);

  return (
    <>
      {languageSelection && (
        <SettingRowNG label={t('Language')}>
          <div className={styles.languagesContainer} ref={ref}>
            <button type="button" className={styles.selectedLanguage} onClick={() => setIsDropdownOpen(prevState => !prevState)}>
              <span>{selectedLanguage?.label}</span>
              <CaretDownIcon className={classNames(styles.caretIcon, { [styles.up]: isDropdownOpen })} />
            </button>
            <div className={classNames(styles.languages, { [styles.displayed]: isDropdownOpen })}>
              {availableLanguages.map(language => (
                <button type="button" key={language.value} onClick={() => handleSelectLanguage(language)} className={styles.language}>
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        </SettingRowNG>
      )}

      {/* How a study opens (imaging-development-env#103). Its own group (Viewer), above Offline storage: that
          group's wording promises its settings govern the copy stored on this device, and this one
          governs no stored copy -- the archives it fetches last for the session. */}
      <SettingRowNG label={t('Viewer')} top>
        {/* The preference belongs to the account and is offered whatever this browser can do; where
            this browser cannot open studies as archives, the help text says what happens here */}
        <SwitchRowNG
          id="study-archive-loading"
          label={t('StudyArchiveLoadingLabel')}
          help={
            studyArchiveLoadingSupported
              ? t('StudyArchiveLoadingHelp')
              : `${t('StudyArchiveLoadingHelp')} ${t('StudyArchiveLoadingUnsupportedHere')}`
          }
          checked={studyArchiveLoading}
          onCheckedChange={onStudyArchiveLoadingChange}
        />
      </SettingRowNG>

      {/* Worded in transfer terms, never as "download an archive": this saves nothing to the
          user's computer -- the Downloads menu is what does that (#129 AR-6). */}
      <SettingRowNG label={t('Offline storage')} top>
        <SwitchRowNG
          id="offline-archive-transfer"
          label={t('OfflineArchiveTransferLabel')}
          help={t('OfflineArchiveTransferHelp')}
          hint={t('OfflineArchiveTransferHint')}
          checked={archiveTransfer}
          onCheckedChange={onArchiveTransferChange}
        />

        {/* Attempt budget (ohif-viewers#131, FR-12). Sits under the transfer strategy because
            both describe how an offline copy is fetched, and neither affects a transfer already
            in progress.

            `Numeric` is the ui-next stepper, so this control looks and behaves like every other
            numeric input in the application rather than like a one-off. No Tailwind classes are
            passed to it: the @source list in ui-next's tailwind-integration.css does not cover
            platform/viewer/src, so utility classes named from here are never generated. The
            stepper's own defaults are used instead. */}
        <NumericRowNG id="offline-retry-attempts" label={t('OfflineRetryAttemptsLabel')} help={t('OfflineRetryAttemptsHelp')} ref={retryFieldRef}>
          <Numeric.Container
            mode="stepper"
            min={RETRY_ATTEMPTS_MIN}
            max={RETRY_ATTEMPTS_MAX}
            step={1}
            value={retryAttempts}
            onChange={onRetryAttemptsChange}
          >
            <Numeric.NumberStepper />
          </Numeric.Container>
        </NumericRowNG>
      </SettingRowNG>

      {/* Attempt budget per file of the Uploads page (imaging-development-env#103): the same
          wording as the offline budget, and like it read when the next batch starts. */}
      <SettingRowNG label={t('Uploads')} top>
        <NumericRowNG id="upload-attempts" label={t('UploadAttemptsLabel')} help={t('UploadAttemptsHelp')} ref={uploadFieldRef}>
          <Numeric.Container
            mode="stepper"
            min={UPLOAD_ATTEMPTS_MIN}
            max={UPLOAD_ATTEMPTS_MAX}
            step={1}
            value={uploadAttempts}
            onChange={onUploadAttemptsChange}
          >
            <Numeric.NumberStepper />
          </Numeric.Container>
        </NumericRowNG>
      </SettingRowNG>
    </>
  );
}

ApplicationSettingsTab.propTypes = {
  archiveTransfer: PropTypes.bool.isRequired,
  onArchiveTransferChange: PropTypes.func.isRequired,
  retryAttempts: PropTypes.number.isRequired,
  onRetryAttemptsChange: PropTypes.func.isRequired,
  /** (delta) => void: Up / Down on the stepper's input */
  onStepRetryAttempts: PropTypes.func.isRequired,
  studyArchiveLoading: PropTypes.bool.isRequired,
  studyArchiveLoadingSupported: PropTypes.bool,
  onStudyArchiveLoadingChange: PropTypes.func.isRequired,
  uploadAttempts: PropTypes.number.isRequired,
  onUploadAttemptsChange: PropTypes.func.isRequired,
  /** (delta) => void: Up / Down on the upload stepper's input */
  onStepUploadAttempts: PropTypes.func.isRequired,
  /** Whether the language row is offered; LANGUAGE_SELECTION_ENABLED unless given */
  languageSelection: PropTypes.bool,
};
