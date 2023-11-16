import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import i18n from '@ohif/i18n';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import useClickOutside from '@ohif/viewer/src/hooks/useClickOutside';

import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import styles from './GeneralTabNG.module.scss';

export default function GeneralTabNG() {
  const { t } = useTranslation();
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

  return (
    <>
      {isDesktop && <TabHeaderNG title="General Settings" />}
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
    </>
  );
}
