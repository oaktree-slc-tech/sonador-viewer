import React from 'react';
import PropTypes from 'prop-types';

import './SimpleDialog.css';


const SimpleDialogShell = ({
  componentRef,
  headerTitle,
  children,
  onClose,
  rootClass = '',
  componentStyle = {},
}) => {
  return (<div className={`simpleDialog ${rootClass}`} ref={componentRef} style={componentStyle}>
    <div className="header">
      <span className="closeBtn" onClick={onClose}>
        <span className="closeIcon">x</span>
      </span>
      <h4 className="title">{headerTitle}</h4>
    </div>
    {children}
  </div>);
};
SimpleDialogShell.propTypes = {
  componentRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  headerTitle: PropTypes.string.isRequired,
  children: PropTypes.node,
  onClose: PropTypes.func.isRequired,
  componentStyle: PropTypes.object,
  rootClass: PropTypes.string,
}


const SimpleDialog = ({
  componentStyle = {},
  rootClass = '',
  componentRef,
  onConfirm,
  onClose,
  headerTitle,
  children,
  btnCancelText='Cancel',
  btnConfirmText='Confirm',
}) => {
  return (<SimpleDialogShell headerTitle={headerTitle} onClose={onClose}
      rootClass={rootClass} componentRef={componentRef} style={componentStyle}>
    <form onSubmit={onConfirm}>
      <div className="content">{children}</div>
      <div className="footer">
        <button type="button" className="btn btn-cancel" onClick={onClose}>
          {btnCancelText}
        </button>
        <button type="button" className="btn btn-confirm" onClick={onConfirm}>
          {btnConfirmText}
        </button>
      </div>
    </form>
  </SimpleDialogShell>);
};

SimpleDialog.propTypes = {
  ...SimpleDialogShell.propTypes,
  onConfirm: PropTypes.func.isRequired,
  headerTitle: PropTypes.string.isRequired,
  btnCancelText: PropTypes.string,
  btnConfirmText: PropTypes.string,
};


export default SimpleDialog;
export { SimpleDialog, SimpleDialogShell };