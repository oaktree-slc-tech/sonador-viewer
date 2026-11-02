// Explicit dismissal for the labelling workflows: a close button and the Escape key. The flows
// stay open until the user finishes or dismisses them; they no longer fade out on mouse leave.

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import Icon from '../../elements/Icon/Icon.js';


function useEscapeKey(onEscape) {
  // Calls the latest onEscape for Escape presses while mounted. Registered on window in the
  // capture phase so it runs before the viewer's hotkeys, which are not meant to see this press.
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || !handlerRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handlerRef.current(event);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}


const LabellingCloseButton = ({ onClose, className = '' }) => {
  const { t } = useTranslation('Common');
  return (
    <button
      type="button"
      className={`labellingCloseButton ${className}`}
      onClick={onClose}
      aria-label={t('Close')}
      title={t('Close')}
    >
      <Icon name="times" width="14px" height="14px" />
    </button>
  );
};

LabellingCloseButton.propTypes = {
  onClose: PropTypes.func.isRequired,
  className: PropTypes.string,
};


export { useEscapeKey, LabellingCloseButton };
