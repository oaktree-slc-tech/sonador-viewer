import _ from 'lodash';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import toggleScrolling from '@ohif/sonador-viewer/src/utils/toggleScrolling';
import { ReactComponent as CloseCircle } from '@ohif/ui/src/elements/Svg/svgs/close-circle.svg';

import styles from './ModalNG.module.scss';


function ModalNG({ isOpen, children, title, onClose, classes, onModalClick, hideDivider=false }) {
  // Sonador Viewer Modal

  const onModalClickEvent = (e) => {
    if (_.isFunction(onModalClick)) {
      onModalClick(e);
    }
    e.stopPropagation();
  }

  // The modal is portalled, but React still bubbles its events to the component that rendered it
  // (a study-list row, a thumbnail). Nothing behind a modal should react to it.
  const stopPropagation = (e) => e.stopPropagation();

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
    <div
      className="sonadorModal"
      onClick={onModalClickEvent}
      onDoubleClick={stopPropagation}
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
    >
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
          console.log('Modal click event');
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
    </div>,
    
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
  onModalClick: PropTypes.func,
};

export default ModalNG;
