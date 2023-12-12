import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import styles from './TabFooterNG.module.scss';

export default function TabFooterNG({ onReset, onSave, hasErrors }) {
  const { t } = useTranslation('UserPreferencesModal');

  return (
    <div className={styles.footer}>
      <button className={styles.reset} onClick={onReset}>
        {t('Reset Defaults')}
      </button>
      <button className={styles.save} disabled={hasErrors} onClick={onSave}>
        {t('Save')}
      </button>
    </div>
  );
}

TabFooterNG.propTypes = {
  onReset: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  hasErrors: PropTypes.bool,
};
