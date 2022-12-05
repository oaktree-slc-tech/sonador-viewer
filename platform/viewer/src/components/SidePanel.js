import './SidePanel.css';

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import { eventTypes as uiEvents } from '@ohif/ui';

const SidePanel = ({ from, isOpen, children, width, transitionDelay }) => {
  const fromSideClass = from === 'right' ? 'from-right' : 'from-left';

  useEffect(() => {
    // Trigger custom event after panel change to allow for viewports to resize
    setTimeout(() => {
      const e = new CustomEvent(uiEvents.sidebar.toggle, { isOpen });
      document.dispatchEvent(e);
    }, transitionDelay);
  }, [isOpen]);

  const styles = width
    ? {
        maxWidth: width,
        marginRight: isOpen ? '0' : Number.parseInt(width) * -1,
      }
    : {};

  return (
    <section
      style={styles}
      className={classNames('sidepanel', fromSideClass, {
        'is-open': isOpen,
      })}
    >
      {children}
    </section>
  );
};

SidePanel.propTypes = {
  from: PropTypes.string.isRequired,
  isOpen: PropTypes.bool.isRequired,
  children: PropTypes.node,
  width: PropTypes.string,
  transitionDelay: PropTypes.number.isRequired,
};

SidePanel.defaultProps = {
  transitionDelay: 300,
};

export default SidePanel;
