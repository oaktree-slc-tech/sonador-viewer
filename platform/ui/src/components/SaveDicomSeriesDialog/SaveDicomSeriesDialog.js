import _ from 'lodash';

import React, { useState } from 'react';
import PropTypes from 'prop-types';

import { Form } from 'radix-ui';

import { SimpleDialog } from '../simpleDialog/SimpleDialog.js';

import './SaveDicomSeriesDialog.css';


const SaveDicomSeriesDialog = ({
    seriesNumber: propSeriesNumber, 
    seriesDescription: propSeriesDescription,
    onCancel, 
    onUpdate, 
    headerTitle, 
    seriesNumberPlacholder, 
    descriptionPlaceholder,
    btnTextConfirm,
    btnTextCancel,
  }) => {
  // Provides a basic dialog which allows for setting 

  // Dialog 
  const [seriesDescription, setSeriesDescription] = useState(propSeriesDescription);
  const [seriesNumber, setSeriesNumber] = useState(propSeriesNumber);
  const [formErrors, setFormErrors] = useState({
    description: false, number: false,
  });


  const handleKeyPress = (e) => {

    // Submit data on enter
    if (e.key == 'Enter') {
      onConfirm();
    }
  }

  
  const handleFieldChange = (e, setFieldVal, errField) => {

    // Toggle form error for field
    if (!e.target.value) {
      setFormErrors(_.extend(formErrors, { [errField]: true }));
    } else {
      setFormErrors(_.extend(formErrors, { [errField]: false }));
    }

    setFieldVal(e.target.value);
  }

  
  const onConfirm = () => {
    // Ensure all series fields have a valid value, trigger update callback for dialog

    // Check dialog state, return if there are errors
    const errors = {
      description: !seriesDescription ? true : false,
      number: !seriesNumber ? true : false,
    };
    if (errors.description || errors.number) {
      setFormErrors(errors);
      return;
    }
   
    onUpdate({ SeriesDescription: seriesDescription, SeriesNumber: seriesNumber });
  }

  return (
    <SimpleDialog
        headerTitle={headerTitle} onClose={onCancel} onConfirm={onConfirm} rootClass="saveDicomSeriesDialog"
        btnTextConfirm={btnTextConfirm} btnTextCancel={btnTextCancel}>
      <Form.Root>

        <Form.Field name="seriesNumber" className="formField">
          <div className="field">
            <Form.Label>Series Number</Form.Label>
            <Form.Message className="formError" match="typeMismatch" forceMatch={formErrors.number}>
              Please enter a valid number.
            </Form.Message>
          </div>
          
          <Form.Control asChild onChange={(e) => handleFieldChange(e, setSeriesNumber, 'number')}>
            <input value={seriesNumber} className="simpleDialogInput" 
              autoFocus type="number" placeholder={seriesNumberPlacholder} onKeyPress={handleKeyPress} required />
          </Form.Control>
        </Form.Field>

        <Form.Field name="seriesDescription" className="formField">
          <div className="field">
            <Form.Label>Series Description</Form.Label>
            <Form.Message className="formError" match="valueMissing" forceMatch={formErrors.description}>
              Please provide a valid series description.
            </Form.Message>
          </div>
          
          <Form.Control asChild onChange={(e) => handleFieldChange(e, setSeriesDescription, 'description')} >
            <input value={seriesDescription} className="simpleDialogInput"
              placeholder={descriptionPlaceholder} onKeyPress={handleKeyPress} required />
          </Form.Control>
        </Form.Field>
      
      </Form.Root>
    </SimpleDialog>
  )
}


SaveDicomSeriesDialog.propTypes = {
  headerTitle: PropTypes.string,
  seriesNumber: PropTypes.number,
  seriesDescription: PropTypes.string,
  onCancel: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
  descriptionPlaceholder: PropTypes.string,
  seriesNumberPlacholder: PropTypes.string,
  btnTextConfirm: PropTypes.string,
  btnTextCancel: PropTypes.string,
}


SaveDicomSeriesDialog.defaultProps = _.extend({}, _.pick(SimpleDialog.defaultProps, 'btnTextConfirm', 'btTextCancel'), {
  headerTitle: 'Save Series',
  seriesNumber: 42,
  seriesDescription: '',
  descriptionPlaceholder: 'Research Derived Series',
  seriesNumberPlacholder: 'Series Number',
});

export default SaveDicomSeriesDialog;