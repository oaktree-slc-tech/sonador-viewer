import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { ReactComponent as CloseCircle } from '@ohif/ui/src/elements/Svg/svgs/close-circle.svg';
import toggleScrolling from '@ohif/viewer/src/utils/toggleScrolling';

import styles from './ModalNG.module.scss';

export default function ModalNG({ isOpen, children, title, onClose, classes }) {
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

  const handleClose = () => {
    onClose();
    toggleScrolling(true);
  };

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <>
      <div className={styles.backdrop} />
      <div className={classNames(styles.content, classes.content)}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <CloseCircle className={styles.closeIcon} onClick={handleClose} />
        </div>
        <hr className={styles.divider} />
        {children}
      </div>
    </>,
    document.getElementById('body')
  );
}

ModalNG.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
  title: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  classes: PropTypes.shape({
    content: PropTypes.string,
  }),
};
