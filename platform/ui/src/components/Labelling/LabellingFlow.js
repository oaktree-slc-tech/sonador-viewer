import * as _ from 'lodash';
import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import Icon from '../../elements/Icon/Icon.js';
import SelectTree from '../selectTree/SelectTree.js';

import EditDescriptionDialog from '../EditDescriptionDialog/EditDescriptionDialog.js';
import LabellingTransition from './LabellingTransition.js';
import { LabellingCloseButton, useEscapeKey } from './labellingDismiss.js';
import OHIFLabellingData from './OHIFLabellingData.js';

import './LabellingFlow.css';


// Black or white, whichever reads better on the given #RRGGBB / #RGB background (WCAG luminance)
const contrastingInk = hex => {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? digits.split('').map(d => d + d).join('') : digits;
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
};


const LabellingFlow = ({
  //  React component that provides a "workflow" to label imaging metadata. Used as part of the
  //  Measurements / Annotations subsystem of OHIF.

  //  Workflow steps:
  //  * Step 1: Load list of available labels/tags
  //  * Step 2: Selecting an item applies it and shows a card with the selected label, where the
  //    label can be changed and a description added (each change applies when it is made).
  //  * Step 3: The check (Done) closes the flow.
  //  The flow stays open until the user closes it (Done, close button or Escape). Escape steps
  //  back first: from a picker opened on the card it returns to the card, and during a description
  //  edit it cancels the edit. Opening a picker during a description edit discards the unsaved
  //  text. When `anatomyData` is provided (the label is a coded tag rather than a location), the
  //  card also offers a Location picker for the anatomic location.

  measurementData,
  editLocation = false,
  locationAttr = 'location',
  locationLabelAttr = 'locationLabel',
  editDescription = false,
  skipAddLabelButton = false,
  updateLabelling,
  labellingDoneCallback,
  editDescriptionOnDialog = false,
  labelData = OHIFLabellingData,
  labelWorkflowTitle = 'Set Location',
  relabelButtonTitle = 'Change Location',
  searchPlaceholder = 'Search anatomy',
  anatomyData,
  anatomyAttr = 'location',
  labelColor,
}) => {
  const { t } = useTranslation('Common');
  const [showComponent, setShowComponent] = useState(true);
  const descriptionInput = useRef();
  const [state, setState] = useState({
    measurementData,
    editLocation,
    editDescription,
    skipAddLabelButton,
    pickingAnatomy: false,
    returnToCard: false,
    anatomyLabel: measurementData && measurementData[anatomyAttr],
    color: {},
    // The last description applied to the measurement; the input is a draft until Save
    description: (!editDescription && measurementData && measurementData.description) || '',
  });

  useEffect(() => {
    const newMeasurementData = _.cloneDeep(measurementData);

    if (editDescription) {
      newMeasurementData.description = undefined;
    }

    if (editLocation) {
      newMeasurementData[locationAttr] = undefined;
    }

    let newEditLocation = editLocation;
    if (!editDescription && !editLocation) {
      newEditLocation = true;
    }

    setState((state) => ({
      ...state,
      editLocation: newEditLocation,
      measurementData: newMeasurementData,
      description: newMeasurementData.description || '',
    }));
  }, [editDescription, editLocation, measurementData]);

  useEffect(() => {
    if (descriptionInput.current) {
      descriptionInput.current.focus();
    }
  }, [state]);

  // Opening a picker from the card ends any description edit; the unsaved draft is discarded
  const relabel = () => setState((state) => ({
    ...state, editLocation: true, returnToCard: true, editDescription: false,
  }));

  const pickAnatomy = () => setState((state) => ({
    ...state, pickingAnatomy: true, returnToCard: true, editDescription: false,
  }));

  const backToCard = () => setState((state) => ({
    ...state, editLocation: false, pickingAnatomy: false, returnToCard: false,
  }));

  const setDescriptionUpdateMode = () => {
    if (descriptionInput.current) {
      descriptionInput.current.focus();
    }
    setState((state) => ({ ...state, editDescription: true }));
  };

  const descriptionCancel = () => {
    if (descriptionInput.current) {
      descriptionInput.current.value = state.description;
    }
    setState((state) => ({ ...state, editDescription: false }));
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      descriptionSave();
    }
  };

  const descriptionSave = () => {
    if (!descriptionInput.current) {
      return;
    }
    const description = descriptionInput.current.value;
    updateLabelling({ description });

    setState((state) => ({
      ...state,
      description,
      editDescription: false,
    }));
  };

  const selectTreeSelectCallback = (event, itemSelected) => {
    if (Array.isArray(itemSelected.items)) {
      return;
    }

    const locationData = {
      [locationAttr]: itemSelected.value,
      [locationLabelAttr]: itemSelected.label,
    }

    const location = itemSelected.value;
    const locationLabel = itemSelected.label;

    updateLabelling(locationData);

    setState((state) => ({
      ...state,
      editLocation: false,
      returnToCard: false,
      color: (labelColor && labelColor(itemSelected)) || {},
      measurementData: {
        ...state.measurementData,
        location,
        locationLabel,
      },
    }));
  };

  const anatomySelectCallback = (event, itemSelected) => {
    if (Array.isArray(itemSelected.items)) {
      return;
    }

    updateLabelling({ [anatomyAttr]: itemSelected.value });
    setState((state) => ({
      ...state,
      pickingAnatomy: false,
      returnToCard: false,
      anatomyLabel: itemSelected.label,
    }));
  };

  const showLabelling = () => {
    setState((state) => ({
      ...state,
      skipAddLabelButton: true,
      editLocation: false,
    }));
  };

  // Closing (close button, Escape, check) removes the flow at once, without the exit fade
  const close = () => labellingDoneCallback();

  useEscapeKey(() => {
    if (editDescriptionOnDialog) {
      return;
    }
    if ((state.editLocation || state.pickingAnatomy) && state.returnToCard) {
      backToCard();
    } else if (state.editDescription) {
      descriptionCancel();
    } else {
      close();
    }
  });

  const descriptionDialogUpdate = (description) => {
    updateLabelling({ description });
    labellingDoneCallback();
  };

  const labellingStateFragment = () => {
    const { skipAddLabelButton, editLocation, pickingAnatomy, anatomyLabel, measurementData, description } = state;
    const { locationLabel, location } = measurementData;

    if (!skipAddLabelButton) {
      return (
        <button type="button" className="addLabelButton" onClick={showLabelling}>
          {location ? 'Edit' : 'Add'} Label
        </button>
      );
    } else {
      if (pickingAnatomy) {
        return (
          <SelectTree
            items={anatomyData}
            columns={1}
            onSelected={anatomySelectCallback}
            selectTreeFirstTitle={t('Set Location')}
            searchPlaceholder={t('Search anatomy')}
          />
        );
      } else if (editLocation) {
        return (
          <SelectTree
            items={labelData}
            columns={1}
            onSelected={selectTreeSelectCallback}
            selectTreeFirstTitle={labelWorkflowTitle}
            searchPlaceholder={searchPlaceholder}
          />
        );
      } else {
        return (
          <>
            <button
              type="button"
              className="checkIconWrapper"
              onClick={close}
              title={t('Done')}
              aria-label={t('Done')}
              style={state.color.Background ? { backgroundColor: state.color.Background } : undefined}
            >
              <Icon
                name="check"
                className="checkIcon"
                style={state.color.Background ? { fill: contrastingInk(state.color.Background) } : undefined}
              />
            </button>
            <div className="locationDescriptionWrapper">
              <div
                className="location"
                style={state.editDescription && state.color.Meaning ? { color: state.color.Meaning } : undefined}
              >
                {locationLabel}
                {anatomyData && anatomyLabel && <span className="anatomy">{anatomyLabel}</span>}
              </div>
              <div className="description">
                <input
                  id="descriptionInput"
                  ref={descriptionInput}
                  defaultValue={description}
                  autoComplete="off"
                  onKeyPress={handleKeyPress}
                />
              </div>
            </div>
            <div className="commonButtons">
              <button type="button" className="commonButton left" onClick={relabel}>
                {relabelButtonTitle}
              </button>
              {anatomyData && (
                <button type="button" className="commonButton" onClick={pickAnatomy}>
                  {t(anatomyLabel ? 'Change Location' : 'Add Location')}
                </button>
              )}
              <button type="button" className="commonButton right" onClick={setDescriptionUpdateMode}>
                {description ? 'Edit ' : 'Add '}
                Description
              </button>
            </div>
            <div className="editDescriptionButtons">
              <button type="button" className="commonButton left" onClick={descriptionCancel}>
                Cancel
              </button>
              <button type="button" className="commonButton right" onClick={descriptionSave}>
                Save
              </button>
            </div>
          </>
        );
      }
    }
  };

  if (editDescriptionOnDialog) {
    return (
      <EditDescriptionDialog
        onCancel={labellingDoneCallback}
        onUpdate={descriptionDialogUpdate}
        description={state.description}
      />
    );
  }

  return (
    <LabellingTransition displayComponent={showComponent} onTransitionExit={labellingDoneCallback}>
      <>
        {/* Keys pressed in the flow are its own; Escape is handled before this (useEscapeKey) */}
        <div
          className={`labellingComponent ${state.editDescription ? 'editDescription' : ''}`}
          onKeyDown={event => event.stopPropagation()}
        >
          <LabellingCloseButton
            onClose={close}
            className={state.editLocation || state.pickingAnatomy || !state.skipAddLabelButton ? 'onPicker' : 'onCard'}
          />
          {labellingStateFragment()}
        </div>
      </>
    </LabellingTransition>
  );
};


LabellingFlow.propTypes = {
  measurementData: PropTypes.object.isRequired,
  labellingDoneCallback: PropTypes.func.isRequired,
  updateLabelling: PropTypes.func.isRequired,
  initialTopDistance: PropTypes.number,
  skipAddLabelButton: PropTypes.bool,
  editLocation: PropTypes.bool,
  locationAttr: PropTypes.string,
  locationLabelAttr: PropTypes.string,
  editDescription: PropTypes.bool,
  editDescriptionOnDialog: PropTypes.bool,
  labelWorkflowTitle: PropTypes.string,
  relabelButtonTitle: PropTypes.string,
  labelData: PropTypes.array,
  searchPlaceholder: PropTypes.string,
  anatomyData: PropTypes.array,
  anatomyAttr: PropTypes.string,
  // ({ Background, Meaning }) display colors of a picked label: Background fills the check button,
  // Meaning colors the label while it is lifted for a description edit
  labelColor: PropTypes.func,
};




export default LabellingFlow;
