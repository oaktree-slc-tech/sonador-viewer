import React, { useEffect } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import WhiteLabelingContext from '../../context/WhiteLabelingContext';
import SideBarNG from '../../components/SideBarNG/SideBarNG';
import { useDeviceStore } from '../../store/useDeviceStore';

import TabletMobileHeader from './components/TabletMobileHeader/TabletMobileHeader';

import styles from './Layout.module.scss';

export default function Layout({ children, type, noHorizontalPadding = false }) {
  const { setDevice, isDesktop } = useDeviceStore();

  const handleResize = () => {
    setDevice(window.innerWidth);
  };

  useEffect(() => {
    handleResize();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <>
      {isDesktop && (
        <WhiteLabelingContext.Consumer>
          {(whiteLabeling) => (
            <SideBarNG>
              {whiteLabeling?.createLogoComponentFn && whiteLabeling.createLogoComponentFn(React)}
            </SideBarNG>
          )}
         </WhiteLabelingContext.Consumer>
      )}
      {!isDesktop && <TabletMobileHeader />}
      <div className={styles.contentContainer} >
        <div className={styles.wrapper}>
          <div
            className={classNames(styles.content, {
              [styles.settingsPadding]: type === 'settings' && !noHorizontalPadding,
              [styles.contentPadding]: !noHorizontalPadding,
            })}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

Layout.propTypes = {
  children: PropTypes.node.isRequired,
  type: PropTypes.oneOf(['default', 'settings']),
  noHorizontalPadding: PropTypes.bool,
};
