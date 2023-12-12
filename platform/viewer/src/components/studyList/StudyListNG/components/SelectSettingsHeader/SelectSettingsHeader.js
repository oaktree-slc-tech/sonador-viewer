import React from 'react';
import PropTypes from 'prop-types';

import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';

import { useDeviceStore } from '../../../../../store/useDeviceStore';
import SettingsHeader from '../SettingsHeader/SettingsHeader';

import styles from './SelectSettingsHeader.module.scss';

export default function SelectSettingsHeader({ table, server }) {
  const { isDesktop } = useDeviceStore();

  return (
    <div className={styles.container}>
      <SettingsHeader server={server} />
      {isDesktop && (
        <CheckboxNG
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          indeterminate={table.getIsSomeRowsSelected()}
        />
      )}
    </div>
  );
}

SelectSettingsHeader.propTypes = {
  table: PropTypes.object.isRequired,
  server: PropTypes.object,
};
