import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Draggable from 'react-draggable';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { utils } from '@ohif/core';

import './DialogProvider.styl';

const DialogContext = createContext(null);

// The stacking order of a dialog, and of one opened over a modal (OHIFModal's overlay is at 1071)
const DIALOG_Z_INDEX = 999;
const ABOVE_MODAL_Z_INDEX = 1072;

// A dialog opened over a modal (`aboveModal`) is placed inside the open modal's content: the modal
// hides the rest of the page from assistive technology and keeps keyboard focus within itself. It
// takes the focus when it opens, and gives it back when it closes.
const openModalContent = () => {
  const contents = typeof document !== 'undefined' ? document.querySelectorAll('.ReactModal__Content') : [];
  return contents.length ? contents[contents.length - 1] : null;
};
const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

export const useDialog = () => useContext(DialogContext);

const DialogProvider = ({ children, service = null }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dialogs, setDialogs] = useState([]);
  const [lastDialogId, setLastDialogId] = useState(null);
  const [lastDialogPosition, setLastDialogPosition] = useState(null);
  const [centerPositions, setCenterPositions] = useState([]);

  useLayoutEffect(() => {
    setCenterPositions(
      dialogs.map((dialog) => ({
        id: dialog.id,
        ...getCenterPosition(dialog.id),
      }))
    );
  }, [dialogs]);

  const getCenterPosition = (id) => {
    const root = document.querySelector('#root');
    const centerX = root.offsetLeft + root.offsetWidth / 2;
    const centerY = root.offsetTop + root.offsetHeight / 2;
    const item = document.querySelector(`#draggableItem-${id}`);
    const itemBounds = item.getBoundingClientRect();
    return {
      x: centerX - itemBounds.width / 2,
      y: centerY - itemBounds.height / 2,
    };
  };

  /**
   * Creates a new dialog and return its id.
   *
   * @param {DialogProps} props The dialog props.
   * @returns The new dialog id.
   */
  const create = useCallback((dialogProps) => {
    const { id, aboveModal } = dialogProps;

    let dialogId = id;
    if (!dialogId) {
      dialogId = utils.guid();
    }

    // Over a modal, the focus goes back where it was in the modal (else to the modal) on close
    let returnFocus;
    if (aboveModal) {
      const modal = openModalContent();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      returnFocus = modal && active && modal.contains(active) ? active : modal;
    }

    setDialogs((dialogs) => [...dialogs, { ...dialogProps, id: dialogId, returnFocus }]);
    setLastDialogId(dialogId);

    return dialogId;
  }, []);

  /**
   * Dismisses the dialog with a given id.
   *
   * @param {Object} props -
   * @property {string} props.id The dialog id.
   * @returns void
   */
  const dismiss = useCallback(({ id }) => setDialogs((dialogs) => {
    const closed = dialogs.find((dialog) => dialog.id === id);
    if (closed && closed.returnFocus) {
      setTimeout(() => closed.returnFocus.isConnected && closed.returnFocus.focus());
    }
    return dialogs.filter((dialog) => dialog.id !== id);
  }), []);

  // A dialog over a modal takes the focus, once, on its first field
  const focused = useRef(new Set());
  useEffect(() => {
    dialogs.filter((dialog) => dialog.aboveModal && !focused.current.has(dialog.id)).forEach((dialog) => {
      const item = document.querySelector(`#draggableItem-${dialog.id}`);
      const field = item && item.querySelector(FOCUSABLE);
      if (field) {
        focused.current.add(dialog.id);
        field.focus();
      }
    });
  }, [dialogs]);

  /**
   * Sets the implementation of a dialog service that can be used by extensions.
   *
   * @returns void
   */
  useEffect(() => {
    if (service) {
      service.setServiceImplementation({ create, dismiss, dismissAll });
    }
  }, [create, dismiss, service]);

  /**
   * Moves the dialog to the foreground if clicked.
   *
   * @param {string} id The dialog id.
   * @returns void
   */
  const _bringToFront = useCallback((id) => {
    setDialogs((dialogs) => {
      const topDialog = dialogs.find((dialog) => dialog.id === id);
      return topDialog ? [...dialogs.filter((dialog) => dialog.id !== id), topDialog] : dialogs;
    });
  }, []);

  /**
   * UI Dialog
   *
   * @typedef {Object} DialogProps
   * @property {string} id The dialog id.
   * @property {DialogContent} content The dialog content.
   * @property {Object} contentProps The dialog content props.
   * @property {boolean} isDraggable Controls if dialog content is draggable or not.
   * @property {boolean} showOverlay Controls dialog overlay.
   * @property {boolean} aboveModal Stack the dialog (and its overlay) above an open modal.
   * @property {boolean} centralize Center the dialog on the screen.
   * @property {boolean} preservePosition Use last position instead of default.
   * @property {ElementPosition} defaultPosition Specifies the `x` and `y` that the dragged item should start at.
   * @property {Function} onStart Called when dragging starts. If `false` is returned any handler, the action will cancel.
   * @property {Function} onStop Called when dragging stops.
   * @property {Function} onDrag Called while dragging.
   */

  useEffect(() => _bringToFront(lastDialogId), [_bringToFront, lastDialogId]);

  /**
   * Dismisses all dialogs.
   *
   * @returns void
   */
  const dismissAll = () => {
    setDialogs([]);
  };

  /**
   * Indicate if there are no dialogs present.
   *
   * @returns True if no dialogs are present.
   */
  const isEmpty = () => dialogs && dialogs.length < 1;

  const renderDialogs = () =>
    dialogs.map((dialog) => {
      const {
        id,
        content: DialogContent,
        contentProps,
        defaultPosition,
        centralize = false,
        preservePosition = true,
        isDraggable = true,
        onStart,
        onStop,
        onDrag,
        showOverlay,
        aboveModal = false,
      } = dialog;
      const zIndex = aboveModal ? ABOVE_MODAL_Z_INDEX : DIALOG_Z_INDEX;

      let position = (preservePosition && lastDialogPosition) || defaultPosition;
      if (centralize) {
        position = centerPositions.find((position) => position.id === id);
      }

      const dragableItem = () => (
        <Draggable
          key={id}
          disabled={!isDraggable}
          position={position}
          defaultPosition={position}
          bounds="parent"
          onStart={(event) => {
            const e = event || window.event;
            const target = e.target || e.srcElement;
            const BLACKLIST = ['SVG', 'BUTTON', 'PATH', 'INPUT', 'SPAN', 'LABEL'];
            if (BLACKLIST.includes(target.tagName.toUpperCase())) {
              return false;
            }

            if (validCallback(onStart)) {
              return onStart(event);
            }
          }}
          onStop={(event) => {
            setIsDragging(false);

            if (validCallback(onStop)) {
              return onStop(event);
            }
          }}
          onDrag={(event) => {
            setIsDragging(true);
            _bringToFront(id);
            _updateLastDialogPosition(id);

            if (validCallback(onDrag)) {
              return onDrag(event);
            }
          }}
        >
          <div
            id={`draggableItem-${id}`}
            className={classNames('DraggableItem', isDragging && 'dragging', isDraggable && 'draggable')}
            style={{ zIndex, position: 'absolute' }}
            onClick={() => _bringToFront(id)}
          >
            <DialogContent {...dialog} {...contentProps} />
          </div>
        </Draggable>
      );

      const node = showOverlay ? (
        <div className="Overlay" key={id} style={{ zIndex }}>
          {dragableItem()}
        </div>
      ) : (
        dragableItem()
      );
      const modal = aboveModal && openModalContent();
      return modal ? ReactDOM.createPortal(<div className="DraggableArea">{node}</div>, modal, id) : node;
    });

  /**
   * Update the last dialog position to be used as the new default position.
   *
   * @returns void
   */
  const _updateLastDialogPosition = (dialogId) => {
    const draggableItemBounds = document.querySelector(`#draggableItem-${dialogId}`).getBoundingClientRect();
    setLastDialogPosition({
      x: draggableItemBounds.x,
      y: draggableItemBounds.y,
    });
  };

  const validCallback = (callback) => callback && typeof callback === 'function';

  return (
    <DialogContext.Provider value={{ create, dismiss, dismissAll, isEmpty }}>
      {!isEmpty() && <div className="DraggableArea">{renderDialogs()}</div>}
      {children}
    </DialogContext.Provider>
  );
};

/**
 *
 * High Order Component to use the dialog methods through a Class Component
 *
 */
export const withDialog = (Component) => {
  return function WrappedComponent(props) {
    const { create, dismiss, dismissAll, isEmpty } = useDialog();
    return <Component {...props} dialog={{ create, dismiss, dismissAll, isEmpty }} />;
  };
};


DialogProvider.propTypes = {
  children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.node), PropTypes.node, PropTypes.func]).isRequired,
  service: PropTypes.shape({
    setServiceImplementation: PropTypes.func,
  }),
};

export default DialogProvider;
