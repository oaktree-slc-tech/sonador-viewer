import React, { useState } from 'react';
import PropTypes from 'prop-types';

import SimpleDialog from '../SimpleDialog/SimpleDialog.js';

import './EditDescriptionDialog.css';

const EditDescriptionDialog = ({ description: propDescription, onCancel, onUpdate }) => {
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
      headerTitle="Edit Description"
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
  description: PropTypes.string,
  measurementData: PropTypes.object.isRequired,
  onCancel: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
};

export default EditDescriptionDialog;
