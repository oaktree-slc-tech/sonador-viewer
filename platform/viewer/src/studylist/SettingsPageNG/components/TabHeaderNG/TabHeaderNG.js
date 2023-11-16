import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import styles from './TabHeaderNG.module.scss';

export default function TabHeaderNG({ title, description }) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className={styles.title}>{t(title)}</h2>
      {description && <p className={styles.description}>{t(description)}</p>}
      <hr className={styles.divider} />
    </>
  );
}

TabHeaderNG.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
};
