import React  from 'react';
import { createPortal } from 'react-dom';

import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/fillClose.svg';

import DeviceList from './DeviceList';

import styles from './DevicesListModal.module.scss';

export default function DevicesListModal({ setIsOpen }) {
  return createPortal(
    <>
      <div className={styles.backdrop} />
      <div className={styles.devicesListModal}>
        <div className={styles.header}>
          <p className={styles.title}>Devices List</p>
          <button className={styles.close} onClick={() => setIsOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <DeviceList/>
      </div>
    </>,
    document.getElementById('body')
  );
}
