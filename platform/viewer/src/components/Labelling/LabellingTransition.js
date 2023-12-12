import React from 'react';
import { CSSTransition } from 'react-transition-group';
import PropTypes from 'prop-types';

import './LabellingTransition.css';

const LabellingTransition = ({ children, displayComponent, onTransitionExit }) => {
  return (
    <CSSTransition in={displayComponent} appear timeout={500} classNames="labelling" onExited={onTransitionExit}>
      {children}
    </CSSTransition>
  );
};

LabellingTransition.propTypes = {
  children: PropTypes.node.isRequired,
  displayComponent: PropTypes.bool.isRequired,
  onTransitionExit: PropTypes.func.isRequired,
};

export default LabellingTransition;
