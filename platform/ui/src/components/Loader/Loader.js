import React from 'react';

import styles from './Loader.module.scss';

function Loader() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.loader} />
    </div>
  );
}

Loader.displayName = 'Loader';

export default Loader;
