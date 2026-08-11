import React, { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as ServerIcon } from '@ohif/ui/src/elements/Svg/svgs/server.svg';

import useClickOutside from '../../hooks/useClickOutside';
import useFlyoutTrigger from '../../hooks/useFlyoutTrigger';
import NavFlyout from '../SideBarNG/NavFlyout';

import flyoutStyles from '../SideBarNG/NavFlyout.module.scss';
import styles from './ImageServerPickerNG.module.scss';

const {
  actions: { setActiveServer },
} = redux;

export default function ImageServerPickerNG({ variant = 'full' }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const servers = useSelector((state) => state.servers.servers);
  const server = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);

  const ref = useRef(null);
  useClickOutside(ref, () => {
    setIsServerDropdownOpen(false);
  });

  // Narrow-rail rendering (ohif-viewers#128). Same redux reads and the same switch behaviour; only
  // the trigger and the surface change, and dismissal comes from the Popover rather than
  // useClickOutside. The `full` rendering below is untouched.
  const flyout = useFlyoutTrigger({ activation: 'menu' });

  const handleSelectServer = (token) => {
    dispatch(setActiveServer(token));
    navigate({ search: `activeServerToken=${token}` });
    setIsServerDropdownOpen(false);
    flyout.close();
  };

  if (variant === 'narrow') {
    const trigger = (
      <button
        type="button"
        className={styles.narrowButton}
        aria-label={server?.name ? `Imaging server: ${server.name}` : 'Imaging server'}
        {...flyout.triggerProps}
      >
        <ServerIcon />
      </button>
    );

    return (
      <NavFlyout
        open={flyout.open}
        onOpenChange={flyout.onOpenChange}
        contentProps={flyout.contentProps}
        anchor={trigger}
        // Names what the flyout is, not what is currently selected. Every navigation flyout's
        // header is its section label, and the active server is already marked in the list below
        // with the same active treatment the sub-navigation uses -- so repeating its name up here
        // both broke that pattern and spent the header row on information already on screen.
        header="Server"
      >
        {servers.map(({ name, token, type }) => (
          <button
            key={token}
            type="button"
            className={classNames(flyoutStyles.item, flyoutStyles.serverItem, {
              [flyoutStyles.active]: token === server?.token,
            })}
            onClick={() => handleSelectServer(token)}
          >
            <p className={flyoutStyles.serverItemName}>{name}</p>
            <p className={flyoutStyles.serverItemType}>{type}</p>
          </button>
        ))}
      </NavFlyout>
    );
  }

  return (
    <div className={styles.container} ref={ref}>
      <button className={styles.buttonMenu} onClick={() => setIsServerDropdownOpen((prevState) => !prevState)}>
        <ServerIcon className={styles.serverIcon} />
        {server?.name}
        <CaretDownIcon
          className={classNames(styles.caretIcon, {
            [styles.up]: isServerDropdownOpen,
          })}
        />
      </button>
      {isServerDropdownOpen && (
        <div className={styles.menu}>
          {servers.map(({ name, token, type }) => {
            return (
              <button
                key={token}
                className={styles.item}
                onClick={() => handleSelectServer(token)}
              >
                <p className={styles.itemName}>{name}</p>
                <p className={styles.itemType}>{type}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


ImageServerPickerNG.propTypes = {
  /** 'full' is the 240px picker; 'narrow' is the 40px icon button used by the collapsed sidebar. */
  variant: PropTypes.oneOf(['full', 'narrow']),
};
