import React, { useEffect, useRef } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import styles from './MultiRangeSlider.module.scss';

const getPercent = (value, min, max) => Math.round(((value - min) / (max - min)) * 100);

export default function MultiRangeSlider({
  minValue,
  maxValue,
  onChangeMaxValue,
  onChangeMinValue,
  min = 0,
  max = 100,
  step = 1,
}) {
  const minValRef = useRef(min);
  const maxValRef = useRef(max);
  const range = useRef(null);

  useEffect(() => {
    const minPercent = getPercent(minValue, min, max);
    const maxPercent = getPercent(maxValRef.current, min, max);

    if (range.current) {
      range.current.style.left = `${minPercent}%`;
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [minValue, min, max]);

  useEffect(() => {
    const minPercent = getPercent(minValRef.current, min, max);
    const maxPercent = getPercent(maxValue, min, max);

    if (range.current) {
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [maxValue, min, max]);

  return (
    <div className={styles.container}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minValue}
        onChange={(event) => {
          const value = Math.min(Number(event.target.value), maxValue - 1);
          onChangeMinValue(value);
          minValRef.current = value;
        }}
        className={classNames(styles.thumb, styles.thumb__left)}
        style={{ zIndex: minValue > max - 100 && '5' }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxValue}
        onChange={(event) => {
          const value = Math.max(Number(event.target.value), minValue + 1);
          onChangeMaxValue(value);
          maxValRef.current = value;
        }}
        className={classNames(styles.thumb, styles.thumb__right)}
      />

      <div className={styles.slider}>
        <div className={styles.slider__track} />
        <div ref={range} className={styles.slider__range} />
        <div className={styles.slider__leftValue}>{minValue}</div>
        <div className={styles.slider__rightValue}>{maxValue}</div>
      </div>
    </div>
  );
}

MultiRangeSlider.propTypes = {
  minValue: PropTypes.number.isRequired,
  maxValue: PropTypes.number.isRequired,
  onChangeMinValue: PropTypes.func.isRequired,
  onChangeMaxValue: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
};
