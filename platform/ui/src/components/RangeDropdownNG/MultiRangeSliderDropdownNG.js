import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import MultiRangeSlider from '../MultiRangeSlider/MultiRangeSlider';

import styles from './MultiRangeSliderDropdownNG.module.scss';

export default function MultiRangeSliderDropdownNG({ title, Button, min, max, step }) {
  const [isOpen, setIsOpen] = useState(false);
  const [minValue, setMinValue] = useState(0);
  const [maxValue, setMaxValue] = useState(100);

  const ref = useRef();

  useClickOutside(ref, () => {
    if (isOpen) {
      setIsOpen(false);
    }
  });

  const resetValues = () => {
    setMinValue(min);
    setMaxValue(max);
  };

  return (
    <div ref={ref} className={styles.rangeDropdownNG}>
      <div onClick={() => setIsOpen((prevState) => !prevState)}>
        <Button />
      </div>
      {isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <p className={styles.title}>Select {title}</p>
            <CloseIcon fill="#ffffff" onClick={() => setIsOpen(false)} className={styles.closeIcon} />
          </div>
          <MultiRangeSlider
            minValue={minValue}
            maxValue={maxValue}
            onChangeMaxValue={setMaxValue}
            onChangeMinValue={setMinValue}
            min={min}
            max={max}
            step={step}
          />
          <div className={styles.resetWrapper}>
            <button className={styles.reset} onClick={resetValues}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

MultiRangeSliderDropdownNG.propTypes = {
  title: PropTypes.string,
  Button: PropTypes.node.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
};
