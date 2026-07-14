import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';

import { OverlayTrigger } from '../overlayTrigger';
import { TableListItem } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';

import './MeasurementTableItem.styl';

const { measurements } = OHIF;
const { DicomMetadataStore } = OHIF;



const ColoredCircle = ({ color }) => {
  return <div className="item-color" style={{ backgroundColor: color }}></div>;
};

ColoredCircle.propTypes = {
  color: PropTypes.string.isRequired,
};


const MeasurementTableItem = ({
  // Render measurement data and actions

  onDelete,
  itemIndex,
  measurementData,
  onRelabel,
  onItemClick,
  onEditDescription,
  itemClass,
  tagBtnLabel = 'Tag',
  descriptionBtnLabel = 'Description',
  deleteBtnLabel = 'Delete',
  isSelected = false,
  isActive,
}) => {
  const { t } = useTranslation('MeasurementTable');

  const [collapsed, setCollapsed] = useState(true);
  const [refVisible, setRefVisible] = useState(false);
  
  const isReadOnly = useMemo(() => {
    return measurementData.isReadOnly;
  }, [measurementData]);

  // Measuement reference metadata
  const refMeta = useMemo(() => {

    // Retrieve instance from DICOM meta store
    const refDcm = DicomMetadataStore.getInstance(
      measurementData.refStudyInstanceUID, measurementData.refSeriesInstanceUID, measurementData.refSOPInstanceUID);
    if (refDcm) {

      // Unpack reference data and mark ref as visible
      setRefVisible(true);
      return _.pick(refDcm, 'SeriesNumber', 'SeriesDescription', 'Modality', 'InstanceNumber' );
    }

    return {};
  }, [isSelected]);

  const getActionButton = (btnLabel, onClickCallback) => {
    return (
      <button key={btnLabel} className="btnAction" onClick={onClickCallback}>
        <span style={{ marginRight: '4px' }}>
          <Icon name="edit" width="14px" height="14px" />
        </span>
        {t(btnLabel)}
      </button>
    );
  };

  const onDeleteClick = (event) => {
    // Remove measurement

    event.stopPropagation();
    onDelete(event, measurementData);
  };

  const onRelabelClick = (event) => {
    // Launch "label" dialog

    event.stopPropagation();
    onRelabel(event, measurementData);
  };

  const onEditDescriptionClick = (event) => {
    // Launch edit description dialot

    event.stopPropagation();
    onEditDescription(event, measurementData);
  };

  const onToggleVisibility = (evt) => {
    // Set visibility of the measurement
    
    evt.stopPropagation();
    measurements.MeasurementApi.Instance.toggleVisibilityMeasurement(
      measurementData.measurementId, !measurementData.isVisible);
    measurements.refreshCornerstoneViewports();
  }

  const handleItemClick = (event) => {
    // Activate the measurement and jumpt to the associated image viewport

    onItemClick(event, measurementData);
  };

  const getTableListItem = () => {
    // Retrieve the table list component

    const hasWarningClass = measurementData.hasWarnings && !isReadOnly ? 'hasWarnings' : '';

    const actionButtons = [];

    if (typeof onRelabel === 'function') {
      const relabelButton = getActionButton(tagBtnLabel, onRelabelClick);
      actionButtons.push(relabelButton);
    }
    if (typeof onEditDescription === 'function') {
      const descriptionButton = getActionButton(descriptionBtnLabel, onEditDescriptionClick);
      actionButtons.push(descriptionButton);
    }
    if (typeof onDelete === 'function') {
      const deleteButton = getActionButton(deleteBtnLabel, onDeleteClick);
      actionButtons.push(deleteButton);
    }
      
    return (
      <TableListItem
        key={measurementData.measurementId}
        itemKey={measurementData.measurementId}
        itemClass={`measurementItem ${itemClass} ${hasWarningClass}`}
        itemIndex={itemIndex}
        onItemClick={handleItemClick}
      >
        <div>
          <div className="measurementContent">
            <div className="displayTexts">{getDataDisplayText()}</div>
            <div className="measurementStatus">
              <Icon
                className={measurementData.isLocked ? `displayIcon` : ''}
                name={measurementData.isVisible ? 'eye' : 'eye-closed'}
                width="20px"
                height="20px"
                onClick={onToggleVisibility}
              />
            {Boolean(measurementData.isLocked) && (
              <Icon name="lock" width="20px" height="20px" />
            )}
            </div>
          </div>
          {refVisible && Boolean(refMeta) && (<div className="referenceMeta">
            <span className="refSxNum">Ser: <b>{refMeta.SeriesNumber}</b></span>
            <span className="refImgNum">Img: {refMeta.InstanceNumber}</span>
            <span className="refSxModality">Modality: {refMeta.Modality}</span>
          </div>)}
          {measurementData && Boolean((measurementData.label || '').replace('...', '')) && (
            <div className="measurementLabel">
              {t(measurementData.label, { keySeparator: '>', nsSeparator: '|', })}
            </div>
          )}
          {isSelected && measurementData.isVisible && !Boolean(isReadOnly) && <div className="rowActions">{actionButtons}</div>}
        </div>
      </TableListItem>
    );
  };

  const getDataDisplayText = () => {
    // Retrieve the display text for the measurement 

    return measurementData.data.map((data, index) => {
      return (
        <div key={`displayText_${index}`} className="measurementDisplayText">
          {data.displayText ? data.displayText : '...'}
        </div>
      );
    });
  };

  const getWarningContent = () => {
    // Create warning list content for the measurement

    const { warningList = '' } = measurementData;

    if (Array.isArray(warningList)) {
      const listedWarnings = warningList.map((warn, index) => {
        return <li key={index}>{warn}</li>;
      });

      return <ol>{listedWarnings}</ol>;
    } else {
      return <>{warningList}</>;
    }
  };

  const { warningTitle = '', hasWarnings } = measurementData;

  return (
    <>
      {hasWarnings && !isReadOnly ? (
        <OverlayTrigger
          key={itemIndex}
          placement="left"
          overlay={
            <Tooltip placement="left" className="in tooltip-warning" id="tooltip-left">
              <div className="warningTitle">{t(warningTitle)}</div>
              <div className="warningContent">{getWarningContent()}</div>
            </Tooltip>
          }
        >
          <div>{getTableListItem()}</div>
        </OverlayTrigger>
      ) : (
        <>{getTableListItem()}</>
      )}
    </>
  );
};


MeasurementTableItem.propTypes = {
  measurementData: PropTypes.object.isRequired,
  onItemClick: PropTypes.func.isRequired,
  onRelabel: PropTypes.func,
  onDelete: PropTypes.func,
  onEditDescription: PropTypes.func,
  itemClass: PropTypes.string,
  itemIndex: PropTypes.number,
  tagBtnLabel: PropTypes.string,
  descriptionBtnLabel: PropTypes.string,
  deleteBtnLabel: PropTypes.string,
  isSelected: PropTypes.bool,
};



export { MeasurementTableItem };
