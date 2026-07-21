import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import { TabFooter, useSnackbarContext } from '@ohif/ui';

import { PREFERENCES_VERSION, PREFERENCE_SECTIONS } from '../../constants/preferences';
import { useUpdateUserPreferenceSection } from '../../queries/preferences';

import { showSaveOutcome } from './saveOutcomeNotification';

import './WindowLevelPreferences.styl';

const { actions } = redux;

function WindowLevelPreferences({ onClose }) {
  const dispatch = useDispatch();

  const windowLevelData = useSelector((state) => {
    const { preferences = {} } = state;
    const { windowLevelData } = preferences;

    return windowLevelData;
  });

  const [state, setState] = useState({
    values: { ...windowLevelData },
  });

  const { t } = useTranslation('UserPreferencesModal');
  const onResetPreferences = () => {};
  const hasErrors = false;

  const { mutate: saveWindowLevelSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.WINDOW_LEVEL);

  const onSave = () => {
    // Redux dispatch unchanged (AR-5): the store subscription keeps the localStorage cache.
    dispatch(actions.setUserPreferences({ windowLevelData: state.values }));

    // Cloud sync through the write queue (FR-7).
    saveWindowLevelSection(
      { version: PREFERENCES_VERSION, values: state.values },
      showSaveOutcome(snackbar, t('SaveMessage'), 'window-level presets')
    );

    onClose();
  };

  const snackbar = useSnackbarContext();

  const handleInputChange = (event) => {
    const $target = event.target;
    const { key, inputname } = $target.dataset;
    const inputValue = $target.value;

    if (!state.values[key] || !state.values[key][inputname]) {
      return;
    }

    setState((prevState) => ({
      ...prevState,
      values: {
        ...prevState.values,
        [key]: {
          ...prevState.values[key],
          [inputname]: inputValue,
        },
      },
    }));
  };

  return (
    <React.Fragment>
      <div className="WindowLevelPreferences">
        <div className="wlColumn">
          <div className="wlRow header">
            <div className="wlColumn preset">Preset</div>
            <div className="wlColumn description">Description</div>
            <div className="wlColumn window">Window</div>
            <div className="wlColumn level">Level</div>
          </div>
          {Object.keys(state.values).map((key) => {
            return (
              <div className="wlRow" key={key}>
                <div className="wlColumn preset">{key}</div>
                <div className="wlColumn description">
                  <input
                    type="text"
                    className="preferencesInput"
                    value={state.values[key].description}
                    data-key={key}
                    data-inputname="description"
                    onChange={handleInputChange}
                  />
                </div>
                <div className="wlColumn window">
                  <input
                    type="number"
                    className="preferencesInput"
                    value={state.values[key].window}
                    data-key={key}
                    data-inputname="window"
                    onChange={handleInputChange}
                  />
                </div>
                <div className="wlColumn level">
                  <input
                    type="number"
                    className="preferencesInput"
                    value={state.values[key].level}
                    data-key={key}
                    data-inputname="level"
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TabFooter
        onResetPreferences={onResetPreferences}
        onSave={onSave}
        onCancel={onClose}
        hasErrors={hasErrors}
        t={t}
      />
    </React.Fragment>
  );
}

WindowLevelPreferences.propTypes = {
  onClose: PropTypes.func,
};

export { WindowLevelPreferences };
