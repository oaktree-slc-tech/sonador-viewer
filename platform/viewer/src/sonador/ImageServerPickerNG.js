import React, { useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import useClickOutside from '../hooks/useClickOutside';

import { ReactComponent as CaretDownIcon } from './caret-down.svg';
import { ReactComponent as ServerIcon } from './server.svg';

import styles from './ImageServerPickerNG.module.scss';

export default function ImageServerPickerNG({ server }) {
  const location = useLocation();

  const servers = useSelector((state) => state.servers.servers);
  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);

  const ref = useRef(null);
  useClickOutside(ref, () => {
    setIsServerDropdownOpen(false);
  });

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
              <Link
                key={token}
                to={{
                  pathname: `/ng/server/${token}/viewer`,
                  search: location.search,
                }}
                className={styles.item}
                onClick={() => {
                  setIsServerDropdownOpen(false);
                }}
              >
                <p className={styles.itemName}>{name}</p>
                <p className={styles.itemType}>{type}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

ImageServerPickerNG.propTypes = {
  server: PropTypes.object,
};
