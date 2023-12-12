import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Icon } from './../../elements/Icon';

import './CineDialog.styl';

const CineDialog = ({
  cineFrameRate = 24,
  isPlaying = false,
  onFrameRateChanged,
  cineMinFrameRate = 1,
  cineMaxFrameRate = 90,
  cineStepFrameRate = 1,
  onClickSkipToEnd,
  onClickNextButton,
  onClickBackButton,
  onClickSkipToStart,
  onPlayPauseChanged,
}) => {
  const { t } = useTranslation('CineDialog');

  const [cineFrameRateValue, setCineFrameRateValue] = useState(cineFrameRate);
  const [isPlayingValue, setIsPlayingValue] = useState(isPlaying);

  useEffect(() => {
    if (isPlaying !== isPlayingValue) {
      setIsPlayingValue(isPlaying);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (cineFrameRate !== cineFrameRateValue) {
      setCineFrameRateValue(cineFrameRate);
    }
  }, [cineFrameRate]);

  const handleInputChange = (event) => {
    const { value } = event.target;

    setCineFrameRateValue(parseFloat(value));

    if (onFrameRateChanged) {
      onFrameRateChanged(parseFloat(value));
    }
  };

  const handleClickPlayPause = () => {
    setIsPlayingValue((prevState) => !prevState);

    if (onPlayPauseChanged) {
      onPlayPauseChanged(!isPlayingValue);
    }
  };

  const handleClickNextButton = (event) => {
    if (onClickNextButton) {
      onClickNextButton(event);
    }
  };

  const handleClickBackButton = (event) => {
    if (onClickBackButton) {
      onClickBackButton(event);
    }
  };

  const handleClickSkipToStart = (event) => {
    if (onClickSkipToStart) {
      onClickSkipToStart(event);
    }
  };

  const handleClickSkipToEnd = (event) => {
    if (onClickSkipToEnd) {
      onClickSkipToEnd(event);
    }
  };

  return (
    <div className="CineDialog">
      <div className="noselect double-row-style">
        <div className="cine-controls">
          <div className="btn-group">
            <button
              title={t('Skip to first image')}
              className="btn"
              data-toggle="tooltip"
              onClick={handleClickSkipToStart}
            >
              <Icon name="fast-backward" />
            </button>
            <button title={t('Previous image')} className="btn" data-toggle="tooltip" onClick={handleClickBackButton}>
              <Icon name="step-backward" />
            </button>
            <button title={t('Play / Stop')} className="btn" data-toggle="tooltip" onClick={handleClickPlayPause}>
              <Icon name={isPlayingValue ? 'stop' : 'play'} />
            </button>
            <button title={t('Next image')} className="btn" data-toggle="tooltip" onClick={handleClickNextButton}>
              <Icon name="step-forward" />
            </button>
            <button
              title={t('Skip to last image')}
              className="btn"
              data-toggle="tooltip"
              onClick={handleClickSkipToEnd}
            >
              <Icon name="fast-forward" />
            </button>
          </div>
        </div>
        <div className="cine-options">
          <div className="fps-section">
            <input
              type="range"
              name="cineFrameRate"
              min={cineMinFrameRate}
              max={cineMaxFrameRate}
              step={cineStepFrameRate}
              value={cineFrameRateValue}
              onChange={handleInputChange}
            />
          </div>
          <span className="fps">
            {cineFrameRateValue.toFixed(1)} {t('fps')}
          </span>
        </div>
      </div>
    </div>
  );
};

CineDialog.propTypes = {
  cineMinFrameRate: PropTypes.number.isRequired,
  /** Maximum value for range slider */
  cineMaxFrameRate: PropTypes.number.isRequired,
  /** Increment range slider can "step" in either direction. */
  cineStepFrameRate: PropTypes.number.isRequired,
  cineFrameRate: PropTypes.number.isRequired,
  /** 'True' if playing, 'False' if paused. */
  isPlaying: PropTypes.bool.isRequired,
  onPlayPauseChanged: PropTypes.func,
  onFrameRateChanged: PropTypes.func,
  onClickNextButton: PropTypes.func,
  onClickBackButton: PropTypes.func,
  onClickSkipToStart: PropTypes.func,
  onClickSkipToEnd: PropTypes.func,
};

export default CineDialog;
