import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import toggleScrolling from '@ohif/sonador-viewer/src/utils/toggleScrolling';
import { ReactComponent as CloseCircle } from '@ohif/ui/src/elements/Svg/svgs/close-circle.svg';

import styles from './ModalNG.module.scss';

function ModalNG({ isOpen, children, title, onClose, classes, hideDivider = false }) {
  useEffect(() => {
    if (isOpen) {
      toggleScrolling(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      toggleScrolling(true);
    };
  }, []);

  const handleClose = (e) => {
    onClose(e);
    toggleScrolling(true);
  };

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <>
      <div
        role="button" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClose(e);
          }
        }}
        aria-label="Close modal backdrop"
        className={styles.backdrop}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      />
      <div className={classNames(styles.content, classes?.content)}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <CloseCircle className={styles.closeIcon} onClick={handleClose} />
        </div>
        {!hideDivider && <hr className={styles.divider} />}
        {children}
      </div>
    </>,
    document.getElementById('body'),
  );
}

ModalNG.displayName = 'ModalNG';

ModalNG.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
  title: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  classes: PropTypes.shape({
    content: PropTypes.string,
  }),
  hideDivider: PropTypes.bool,
};

export default ModalNG;
