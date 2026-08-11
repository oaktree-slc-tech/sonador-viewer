import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import classNames from 'classnames';

import OHIF from '@ohif/core';

import { ReactComponent as BurgerIcon } from '@ohif/ui/src/elements/Svg/svgs/burger-menu.svg';
import { ReactComponent as Logo } from '@ohif/ui/src/elements/Svg/svgs/sonador-logo.svg';

import WhiteLabelingContext from '../../../../context/WhiteLabelingContext';
import ImageServerPickerNG from '../../../../components/ImageServerPickerNG/ImageServerPickerNG';
import SideBarNG from '../../../../components/SideBarNG/SideBarNG';
import OHIFLogo from '../../../../components/OHIFLogo/OHIFLogo.js';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import toggleScrolling from '../../../../utils/toggleScrolling';

import styles from './TabletMobileHeader.module.scss';

const { redux } = OHIF;

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

  const serverCount = useSelector(redux.selectors.serverCount);

  return (
    <>
      <div className={styles.container}>
        <div className={styles.left}>
          <button className={styles.burgerWrapper} onClick={handleOpenSideBar}>
            <BurgerIcon />
          </button>
          {isLarge && (
            <Link to="/" className={styles.logoWrapper}>
              <WhiteLabelingContext.Consumer>
                {(whiteLabeling) => (
                  <>
                  {whiteLabeling?.createLogoComponentFn 
                    ? whiteLabeling.createLogoComponentFn(React)
                    : <OHIFLogo />}
                  </>
                )}
              </WhiteLabelingContext.Consumer>
            </Link>
          )}
        </div>
        {serverCount && (serverCount > 0) && (
          <ImageServerPickerNG />
        )}
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
              <WhiteLabelingContext.Consumer>
                {/* Always full width: the collapse control is a desktop affordance and the drawer
                    must not inherit a collapsed desktop state (ohif-viewers#128, FR-19). */}
                {(whiteLabeling) => (
                  <SideBarNG mode="full">
                    {whiteLabeling?.createLogoComponentFn && whiteLabeling.createLogoComponentFn(React)}
                  </SideBarNG>
                )}
              </WhiteLabelingContext.Consumer>
            </div>
          </div>
        </>,
        document.getElementById('body')
      )}
    </>
  );
}
