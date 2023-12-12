import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import classNames from 'classnames';

import { redux } from '@ohif/core';
import { useSnackbarContext } from '@ohif/ui';

import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import styles from './WindowLevelTabNG.module.scss';

const { actions } = redux;

export default function WindowLevelTabNG() {
  const { t } = useTranslation('UserPreferencesModal');

  const dispatch = useDispatch();

  const windowLevelData = useSelector((state) => {
    const { preferences = {} } = state;
    const { windowLevelData } = preferences;

    return windowLevelData;
  });

  const [state, setState] = useState({
    values: { ...windowLevelData },
  });

  const { isDesktop } = useDeviceStore();
  const snackbar = useSnackbarContext();

  const onSave = () => {
    dispatch(actions.setUserPreferences({ windowLevelData: state.values }));

    snackbar.show({
      message: t('SaveMessage'),
      type: 'success',
    });
  };

  const handleInputChange = (key, name) => (event) => {
    const { value } = event.target;

    if (!state.values[key] || !state.values[key][name]) {
      return;
    }

    setState((prevState) => ({
      ...prevState,
      values: {
        ...prevState.values,
        [key]: {
          ...prevState.values[key],
          [name]: value,
        },
      },
    }));
  };

  return (
    <>
      {isDesktop && <TabHeaderNG title="Window level" description="Someone explain what this is to me" />}
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.preset} />
          <p className={styles.description}>Description</p>
          <p className={styles.window}>Window</p>
          <p className={styles.level}>Level</p>
        </div>
        {Object.entries(state.values).map(([preset, { description, window, level }]) => {
          const isAnyValue = !!description || !!window || !!level;

          return (
            <div className={styles.row} key={preset}>
              <p className={classNames(styles.preset, { [styles.active]: isAnyValue })}>{preset}</p>
              <input
                type="text"
                className={classNames(styles.description, { [styles.active]: !!description })}
                value={description}
                onChange={handleInputChange(preset, 'description')}
                placeholder="Soft Tissue"
              />
              <input
                type="number"
                className={classNames(styles.window, { [styles.active]: !!window })}
                value={window}
                onChange={handleInputChange(preset, 'window')}
                placeholder="550"
              />
              <input
                type="number"
                className={classNames(styles.level, { [styles.active]: !!level })}
                value={level}
                onChange={handleInputChange(preset, 'level')}
                placeholder="40"
              />
            </div>
          );
        })}
      </div>
      <TabFooterNG onReset={() => {}} onSave={onSave} onCancel={() => {}} hasErrors={false} />
    </>
  );
}
