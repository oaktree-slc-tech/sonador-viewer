import React, { useEffect } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { eventTypes as uiEvents } from '@ohif/ui';

import './SidePanel.css';

const { DisplaySetApi } = OHIF.display;


const SidePanel = ({ from, isOpen, children, width, transitionDelay = 300 }) => {
  const fromSideClass = from === 'right' ? 'from-right' : 'from-left';

  useEffect(() => {
    
    // Trigger custom event after panel change to allow for viewports to resize
    setTimeout(() => {

      // Trigger displaySetService data sync event
      DisplaySetApi.Instance.displaySetService.triggerApiEvent(
        OHIF.display.Enums.EVENTS.UI, { component: 'sidebar', uiEvent: uiEvents.sidebar.toggle, isOpen });

      // Trigger browser custom event
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
  transitionDelay: PropTypes.number,
};

export default SidePanel;
