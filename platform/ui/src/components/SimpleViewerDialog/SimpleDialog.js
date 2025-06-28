import React from 'react';
import PropTypes from 'prop-types';

import './SimpleDialog.css';


const SimpleDialog = ({
  componentStyle = {},
  rootClass = '',
  componentRef,
  onConfirm,
  onClose,
  headerTitle,
  children,
}) => {
  return (
    <div className={`simpleDialog ${rootClass}`} ref={componentRef} style={componentStyle}>
      <form onSubmit={onConfirm}>
        <div className="header">
          <span className="closeBtn" onClick={onClose}>
            <span className="closeIcon">x</span>
          </span>
          <h4 className="title">{headerTitle}</h4>
        </div>
        <div className="content">{children}</div>
        <div className="footer">
          <button type="button" className="btn btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-confirm" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
};

SimpleDialog.propTypes = {
  componentStyle: PropTypes.object,
  rootClass: PropTypes.string,
  componentRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  headerTitle: PropTypes.string.isRequired,
  children: PropTypes.node,
};


export default SimpleDialog;
