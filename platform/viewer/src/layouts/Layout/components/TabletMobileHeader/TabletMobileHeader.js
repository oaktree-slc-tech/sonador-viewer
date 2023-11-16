import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import classNames from 'classnames';

import { ReactComponent as BurgerIcon } from '@ohif/ui/src/elements/Svg/svgs/burger-menu.svg';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';

import ImageServerPickerNG from '../../../../sonador/ImageServerPickerNG';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import SideBarNG from '../../../../studylist/SideBarNG/SideBarNG';
import toggleScrolling from '../../../../utils/toggleScrolling';

import styles from './TabletMobileHeader.module.scss';

export default function TabletMobileHeader() {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

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
            <Link to="/ng" className={styles.logoWrapper}>
              <Logo width={133} height={30} />
            </Link>
          )}
        </div>
        <ImageServerPickerNG server={activeServer} />
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
