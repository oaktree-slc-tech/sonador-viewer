// Explicit dismissal for the labelling workflows: a close button and the Escape key. The flows
// stay open until the user finishes or dismisses them; they no longer fade out on mouse leave.
// While a flow is open it is modal: pointer input outside its dialog does not reach the viewports
// or the tool under the pointer (useModalPointerGuard).

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


// Pointer input a modal flow keeps from the rest of the viewer. Releases (mouseup, touchend,
// pointerup) pass, so an interaction that began before the flow opened can end.
const GUARDED_EVENTS = [
  'pointerdown', 'mousedown', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel',
  'touchstart', 'touchmove',
];

// The flow's own dialog, and the popups it may open outside it
const INSIDE_FLOW = '.DraggableItem, .labellingComponent, [data-radix-popper-content-wrapper], [role="listbox"], [role="tooltip"]';

function useModalPointerGuard() {
  // While mounted, pointer input outside the flow is stopped in the window capture phase, before
  // it reaches the viewport elements (it does not run ahead of other window listeners): the
  // viewport and its active tool do not see clicks, drags or wheel turns, and a measurement
  // selected for labelling is not changed underneath the dialog.
  useEffect(() => {
    const onPointer = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest(INSIDE_FLOW)) {
        return;
      }
      event.stopPropagation();
      if (event.cancelable && event.type !== 'mousemove') {
        event.preventDefault();
      }
    };
    GUARDED_EVENTS.forEach(type => window.addEventListener(type, onPointer, { capture: true, passive: false }));
    return () => GUARDED_EVENTS.forEach(type => window.removeEventListener(type, onPointer, { capture: true }));
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


export { useEscapeKey, useModalPointerGuard, LabellingCloseButton };
