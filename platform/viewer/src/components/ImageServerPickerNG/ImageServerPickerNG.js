import React, { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';

import { redux } from '@ohif/core';
import { ReactComponent as CaretDownIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as ServerIcon } from '@ohif/ui/src/elements/Svg/svgs/server.svg';

import useClickOutside from '../../hooks/useClickOutside';

import styles from './ImageServerPickerNG.module.scss';

const {
  actions: { setActiveServer },
} = redux;

export default function ImageServerPickerNG() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const servers = useSelector((state) => state.servers.servers);
  const server = useSelector((state) => state.servers.servers.find((s) => s.active));

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
              <button
                key={token}
                className={styles.item}
                onClick={() => {
                  dispatch(setActiveServer(token));
                  navigate({ search: `activeServerToken=${token}` });
                  setIsServerDropdownOpen(false);
                }}
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
