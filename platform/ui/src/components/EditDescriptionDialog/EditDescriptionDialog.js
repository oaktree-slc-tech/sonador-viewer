import React, { useState } from 'react';
import PropTypes from 'prop-types';

import SimpleDialog from '../SimpleViewerDialog/SimpleDialog.js';

import './EditDescriptionDialog.css';


const EditDescriptionDialog = ({ description: propDescription, onCancel, onUpdate, headerTitle }) => {
  // Provides a basic dialog with an edit control for modifying a "description"

  const [description, setDescription] = useState(propDescription || '');

  const onConfirm = (e) => {
    e.preventDefault();    
    onUpdate(description);
  };

  const handleChange = (event) => {
    setDescription(event.target.value);
  };

  return (
    <SimpleDialog
      headerTitle={headerTitle}
      onClose={onCancel}
      onConfirm={onConfirm}
      rootClass="editDescriptionDialog"
    >
      <input
        value={description}
        className="simpleDialogInput"
        id="description"
        autoComplete="off"
        autoFocus
        onChange={handleChange}
      />
    </SimpleDialog>
  );
};


EditDescriptionDialog.propTypes = {
  headerTitle: PropTypes.string,
  description: PropTypes.string,
  onCancel: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
};


EditDescriptionDialog.defaultProps = {
  headerTitle: 'Edit Description',
}


export default EditDescriptionDialog;
