import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/fillClose.svg';
import { ReactComponent as RemoveIcon } from '@ohif/ui/src/elements/Svg/svgs/fillRemove.svg';

import styles from './DevicesListModal.module.scss';

export default function DevicesListModal({ setIsOpen }) {
  const { t } = useTranslation();

  const [devicesList, setDevicesList] = useState(new Array(4).fill(0).map((_, index) => index));

  const addListItem = () => {
    setDevicesList((prevState) => [...prevState, 0]);
  };

  const removeListItem = (id) => {
    setDevicesList(devicesList.filter((_, index) => index !== id));
  };

  return createPortal(
    <>
      <div className={styles.backdrop} />
      <div className={styles.devicesListModal}>
        <div className={styles.header}>
          <p className={styles.title}>{t('Devices List')}</p>
          <button className={styles.close} onClick={() => setIsOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <div className={styles.listHeader}>
          <div className={styles.listHeaderFirstItem} />
          <p className={styles.headerName}>{t('Name')}</p>
          <p className={styles.headerModel}>{t('Model')}</p>
          <p className={styles.headerType}>{t('Type')}</p>
          <div className={styles.listHeaderLastItem} />
        </div>
        <div className={styles.list}>
          {devicesList.map((_, index) => {
            return (
              <div key={index} className={styles.listItem}>
                <p className={styles.listItemNumber}>{index + 1}</p>
                <input type="text" className={styles.nameInput} />
                <input type="text" className={styles.modelInput} />
                <input type="text" className={styles.typeInput} />
                <button className={styles.remove} onClick={() => removeListItem(index)}>
                  <RemoveIcon />
                </button>
              </div>
            );
          })}
        </div>
        <div className={styles.addNewContainer}>
          <button className={styles.addNewBtn} onClick={addListItem}>
            <AddCircleIcon />
            <span>{t('Add New')}</span>
          </button>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancel}>{t('Cancel')}</button>
          <button className={styles.save}>{t('Save')}</button>
        </div>
      </div>
    </>,
    document.getElementById('body')
  );
}
