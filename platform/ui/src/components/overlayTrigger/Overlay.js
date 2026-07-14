import React, { cloneElement } from 'react';
import { Overlay as BaseOverlay } from 'react-overlays';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import Fade from './Fade';

function Overlay({ animation = Fade, rootClose = false, show = false, placement = 'right', children, ...props }) {
  const transition = animation === true ? Fade : animation || null;
  let child;

  if (!transition) {
    child = cloneElement(children, {
      className: classNames(children.props.className, 'in'),
    });
  } else {
    child = children;
  }

  return (
    <BaseOverlay {...props} show={show} rootClose={rootClose} placement={placement} transition={transition}>
      {child}
    </BaseOverlay>
  );
}

Overlay.propTypes = {
  /**
   * Set the visibility of the Overlay
   */
  show: PropTypes.bool,
  /**
   * Specify whether the overlay should trigger onHide when the user clicks outside the overlay
   */
  rootClose: PropTypes.bool,
  /**
   * A callback invoked by the overlay when it wishes to be hidden. Required if
   * `rootClose` is specified.
   */
  onHide: PropTypes.func,

  /**
   * Use animation
   */
  animation: PropTypes.oneOfType([PropTypes.bool, PropTypes.elementType]),

  /**
   * Callback fired before the Overlay transitions in
   */
  onEnter: PropTypes.func,

  /**
   * Callback fired as the Overlay begins to transition in
   */
  onEntering: PropTypes.func,

  /**
   * Callback fired after the Overlay finishes transitioning in
   */
  onEntered: PropTypes.func,

  /**
   * Callback fired right before the Overlay transitions out
   */
  onExit: PropTypes.func,

  /**
   * Callback fired as the Overlay begins to transition out
   */
  onExiting: PropTypes.func,

  /**
   * Callback fired after the Overlay finishes transitioning out
   */
  onExited: PropTypes.func,

  /**
   * Sets the direction of the Overlay.
   */
  placement: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  children: PropTypes.node,
};

export default Overlay;
