import React, { useState } from 'react';
import PropTypes from 'prop-types';

import { Form } from 'radix-ui';

import { TextInput } from '@ohif/ui';

import './SimpleDialog.styl';

const SimpleDialog = ({
  children,
  componentRef,
  componentStyle = {},
  rootClass = '',
  isOpen = true,
  headerTitle,
  onClose,
  onConfirm,
  btnTextConfirm,
  btnTextCancel,
}) => {
  const handleClose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const handleConfirm = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onConfirm();
  };

  return (
    <>
      {isOpen && (
        <div className={`simpleDialog ${rootClass} `} ref={componentRef} style={componentStyle}>
          <div className="header">
            <span className="closeBtn" onClick={handleClose}>
              <span className="closeIcon">x</span>
            </span>
            <h4 className="title">{headerTitle}</h4>
          </div>
          
          <div className="content">{children}</div>
          
          <div className="footer">
            <button className="btn btn-default" onClick={handleClose}>{btnTextCancel}</button>
            <button className="btn btn-primary" onClick={handleConfirm}>{btnTextConfirm}</button>
          </div>
        </div>
      )}
    </>
  );
};


SimpleDialog.propTypes = {
  children: PropTypes.node,
  componentRef: PropTypes.any,
  componentStyle: PropTypes.object,
  rootClass: PropTypes.string,
  isOpen: PropTypes.bool,
  headerTitle: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  btnTextConfirm: PropTypes.string,
  btnTextCancel: PropTypes.string,
};


SimpleDialog.defaultProps = {
  btnTextConfirm: 'Confirm',
  btnTextCancel: 'Cancel',
}


const InputDialog = ({ onSubmit, defaultValue, title, label, onClose }) => {
  const [inputDialogValue, setInputDialogValue] = useState(defaultValue);

  const onSubmitHandler = () => {
    onSubmit(inputDialogValue);
  };

  return (
    <div className="InputDialog">
      <SimpleDialog headerTitle={title} onClose={onClose} onConfirm={onSubmitHandler}>
        <TextInput
          type="text"
          value={inputDialogValue}
          onChange={(event) => setInputDialogValue(event.target.value)}
          label={label}
        />
      </SimpleDialog>
    </div>
  );
};


export { SimpleDialog, InputDialog };