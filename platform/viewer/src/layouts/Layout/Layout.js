import React, { useEffect } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { useDeviceStore } from '../../store/useDeviceStore';
import { SIDEBAR_MODE_NARROW, SIDEBAR_WIDTHS, useSidebarStore } from '../../store/useSidebarStore';
import WhiteLabelingContext from '../../context/WhiteLabelingContext';

import SideBarNG from '../../components/SideBarNG/SideBarNG';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';

import TabletMobileHeader from './components/TabletMobileHeader/TabletMobileHeader';

import styles from './Layout.module.scss';


export default function Layout({
  children,
  type,
  noHorizontalPadding = false,
  fixedHeight = false,
  showSettings = true,
}) {
  const { setDevice, isDesktop } = useDeviceStore();
  const sidebarMode = useSidebarStore((state) => state.mode);

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
    <div
      className={classNames({ [styles.fixedHeightShell]: fixedHeight })}
      // Single source for the rail width: the sidebar sizes itself from it and the content area
      // offsets itself by it, so the two transition as one (ohif-viewers#128, AR-2).
      style={{ '--sonador-sidebar-width': SIDEBAR_WIDTHS[sidebarMode] }}
    >
      {isDesktop && (
        <WhiteLabelingContext.Consumer>
          {(whiteLabeling) => (
            <SideBarNG showSettings={showSettings} mode={sidebarMode}>
              {
                // Undefined rather than false when the deployment supplies no branding function
                // for this mode, so SideBarNG's own per-mode fallback takes over; a `false` child
                // would suppress the header entirely.
                sidebarMode === SIDEBAR_MODE_NARROW
                  ? whiteLabeling?.createNarrowLogoComponentFn?.(React)
                  : whiteLabeling?.createLogoComponentFn?.(React)
              }
            </SideBarNG>
          )}
         </WhiteLabelingContext.Consumer>
      )}
      {!isDesktop && <TabletMobileHeader />}
      <div className={classNames(styles.contentContainer, { [styles.fixedHeight]: fixedHeight })} >
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
    </div>
  );
}


Layout.propTypes = {
  children: PropTypes.node.isRequired,
  type: PropTypes.oneOf(['default', 'settings']),
  noHorizontalPadding: PropTypes.bool,
  fixedHeight: PropTypes.bool,

  /** Set false on surfaces with no session behind them, such as the sign-out confirmation. */
  showSettings: PropTypes.bool,
};
