import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import styles from './TimePickerNG.module.scss';

export default function TimePickerNG({ Button, position = 'left', title }) {
  const [isOpen, setIsOpen] = useState(false);

  const ref = useRef(null);
  const pickerRef = useRef(null);

  const callback = useCallback(() => setIsOpen(false), [setIsOpen]);
  useClickOutside([ref, pickerRef], callback);

  const { top, height, right, left } = ref.current?.getBoundingClientRect() || {};

  const style = {
    top: height + top + window.scrollY + 10,
  };

  if (position === 'left') {
    style.left = left;
  } else {
    style.right = window.innerWidth - right;
  }

  return (
    <>
      <div ref={ref} onClick={() => setIsOpen((prevState) => !prevState)}>
        <Button />
      </div>
      {isOpen &&
        createPortal(
          <div className={styles.timePicker} style={style} ref={pickerRef}>
            <div className={styles.header}>
              <h2 className={styles.title}>Select {title} Time</h2>
              <CloseIcon className={styles.closeIcon} fill="#FFFFFF" onClick={() => setIsOpen(false)} />
            </div>
            <div className={styles.pickers}>
              <div className={styles.pickerContainer}>
                <h3 className={styles.pickerTitle}>Start Time</h3>
                <input type="text" className={styles.picker} placeholder="HH/MM" />
              </div>
              <div className={styles.pickerContainer}>
                <h3 className={styles.pickerTitle}>End Time</h3>
                <input type="text" className={styles.picker} placeholder="HH/MM" />
              </div>
            </div>
            <div className={styles.resetContainer}>
              <button className={styles.resetBtn}>Reset</button>
            </div>
          </div>,
          document.getElementById('body')
        )}
    </>
  );
}

TimePickerNG.propTypes = {
  Button: PropTypes.node.isRequired,
  position: PropTypes.oneOf(['left', 'right']),
  title: PropTypes.string.isRequired,
};
