import React from 'react';

import styles from './Loader.module.scss';

export default function Loader() {
  return (
    <div className={styles.loader__wrapper}>
      <div className={styles.loader} />
    </div>
  );
}
