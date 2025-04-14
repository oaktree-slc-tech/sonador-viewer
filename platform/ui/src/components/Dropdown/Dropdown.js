import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';

import styles from './Dropdown.module.scss';

export default function Dropdown({ Button, options, onClick, position = 'left' }) {
  const [isOpen, setIsOpen] = useState(false);

  const ref = useRef(null);
  const dropdownRef = useRef(null);
  const callback = useCallback(() => setIsOpen(false), [setIsOpen]);
  useClickOutside([ref, dropdownRef], callback);

  const { top = 0, height = 0, right = 0, left = 0 } = ref.current?.getBoundingClientRect() || {};
  const { width: dropdownWidth = 0 } = dropdownRef.current?.getBoundingClientRect() || {};

  const style = {
    top: height + top + window.scrollY + 10,
  };

  if (position === 'left') {
    if (left + dropdownWidth > window.innerWidth) {
      style.left = left - (left + dropdownWidth - window.innerWidth);
    } else {
      style.left = left;
    }
  } else {
    style.right = window.innerWidth - right;
  }

  return (
    <div className={styles.container} ref={ref}>
      <div
        onClick={(e) => {
          onClick(e);
          setIsOpen((prevState) => !prevState);
        }}
      >
        <Button />
      </div>
      {isOpen &&
        createPortal(
          <div ref={dropdownRef} className={styles.dropdown} style={style}>
            {options.map(({ id, Label, onClick }) => {
              return (
                <button
                  key={id}
                  onClick={() => {
                    onClick();
                    setIsOpen(false);
                  }}
                  className={styles.option}
                >
                  <Label />
                </button>
              );
            })}
          </div>,
          document.getElementById('body')
        )}
    </div>
  );
}

Dropdown.propTypes = {
  Button: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      Label: PropTypes.func,
      onClick: PropTypes.func,
    })
  ).isRequired,
  onClick: PropTypes.func,
  position: PropTypes.oneOf(['left', 'right']),
};
