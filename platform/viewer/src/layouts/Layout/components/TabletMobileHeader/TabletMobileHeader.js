import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import classNames from 'classnames';

import { ReactComponent as BurgerIcon } from '@ohif/ui/src/elements/Svg/svgs/burger-menu.svg';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';

import ImageServerPickerNG from '../../../../components/ImageServerPickerNG/ImageServerPickerNG';
import SideBarNG from '../../../../components/SideBarNG/SideBarNG';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import toggleScrolling from '../../../../utils/toggleScrolling';

import styles from './TabletMobileHeader.module.scss';

export default function TabletMobileHeader() {
  const { isLarge } = useDeviceStore();

  const [isOpenedMenu, setIsOpenedMenu] = useState(false);

  const handleClickBackdrop = () => {
    setIsOpenedMenu(false);
    toggleScrolling(true);
  };

  const handleOpenSideBar = () => {
    setIsOpenedMenu(true);
    toggleScrolling(false);
  };

  return (
    <>
      <div className={styles.container}>
        <div className={styles.left}>
          <button className={styles.burgerWrapper} onClick={handleOpenSideBar}>
            <BurgerIcon />
          </button>
          {isLarge && (
            <Link to="/" className={styles.logoWrapper}>
              <Logo />
            </Link>
          )}
        </div>
        <ImageServerPickerNG />
      </div>
      {createPortal(
        <>
          {isOpenedMenu && <div className={styles.backdrop} onClick={handleClickBackdrop} />}
          <div
            className={classNames(styles.swipeMenu, {
              [styles.opened]: isOpenedMenu,
            })}
          >
            <div className={styles.sideBarContainer}>
              <SideBarNG />
            </div>
          </div>
        </>,
        document.getElementById('body')
      )}
    </>
  );
}
