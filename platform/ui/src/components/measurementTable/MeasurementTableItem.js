import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { Tooltip as HoverTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import { OverlayTrigger } from '../overlayTrigger';
import { TableListItem } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';

import { subscribeSeriesMetadata } from './metadataEventConcerns';
import './MeasurementTableItem.styl';

const { measurements } = OHIF;
const { DicomMetadataStore } = OHIF;



const ColoredCircle = ({ color }) => {
  return <div className="item-color" style={{ backgroundColor: color }}></div>;
};

ColoredCircle.propTypes = {
  color: PropTypes.string.isRequired,
};


// Label line clipped with an ellipsis; hovering shows the full text when it does not fit
const TruncatedLabel = ({ text }) => {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <HoverTooltip open={open} onOpenChange={next => setOpen(next && ref.current && ref.current.scrollWidth > ref.current.clientWidth)}>
        <TooltipTrigger asChild>
          <div ref={ref} className="measurementLabel">{text}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="measurementLabelTooltip">{text}</TooltipContent>
      </HoverTooltip>
    </TooltipProvider>
  );
};


TruncatedLabel.propTypes = {
  text: PropTypes.string.isRequired,
};


// A Series Tag finding with a custom background is marked by a band of that color on the inside
// right edge of its index cell
const seriesTagBand = seriesTagDisplay => {
  const background = seriesTagDisplay && seriesTagDisplay.color && seriesTagDisplay.color.Background;
  return background ? { boxShadow: `inset -5px 0 0 ${background}` } : undefined;
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
  
  const isReadOnly = useMemo(() => {
    return measurementData.isReadOnly;
  }, [measurementData]);

  // Series Tags describe a whole series: their meta line shows the series, not the image
  const isSeriesTag = Boolean(measurementData.seriesTagDisplay);

  // Measurement reference metadata, recomputed when the reference or the series metadata changes
  const { refStudyInstanceUID, refSeriesInstanceUID, refSOPInstanceUID } = measurementData;
  const [metadataVersion, setMetadataVersion] = useState(0);

  useEffect(
    () => subscribeSeriesMetadata(DicomMetadataStore, refSeriesInstanceUID, () => setMetadataVersion(version => version + 1)),
    [refSeriesInstanceUID]
  );

  const refMeta = useMemo(() => {
    const identifiers = OHIF.utils.referenceIdentifiers(DicomMetadataStore, {
      StudyInstanceUID: refStudyInstanceUID, SeriesInstanceUID: refSeriesInstanceUID, SOPInstanceUID: refSOPInstanceUID,
    });

    // A measurement's line includes its image, so it needs the instance; a Series Tag needs only its series
    if (!identifiers || (!isSeriesTag && identifiers.InstanceNumber === undefined)) {
      return null;
    }
    return identifiers;
  }, [refStudyInstanceUID, refSeriesInstanceUID, refSOPInstanceUID, isSeriesTag, metadataVersion]);

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
        itemIndexStyle={seriesTagBand(measurementData.seriesTagDisplay)}
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
          {refMeta && (<div className="referenceMeta">
            <span className="refItem refSxNum"><span className="refLabel">S:</span><span className="refValue">{refMeta.SeriesNumber}</span></span>
            {!isSeriesTag && (
              <span className="refItem refImgNum"><span className="refLabel">I:</span><span className="refValue">{refMeta.InstanceNumber}</span></span>
            )}
            <span className="refItem refSxModality"><span className="refLabel">Modality:</span><span className="refValue">{refMeta.Modality}</span></span>
          </div>)}
          {measurementData && Boolean((measurementData.label || '').replace('...', '')) && (
            <TruncatedLabel text={t(measurementData.label, { keySeparator: '>', nsSeparator: '|', })} />
          )}
          {isSelected && measurementData.isVisible && !Boolean(isReadOnly) && <div className="rowActions">{actionButtons}</div>}
        </div>
      </TableListItem>
    );
  };

  const getDataDisplayText = () => {
    // Retrieve the display text for the measurement 

    const { seriesTagDisplay } = measurementData;
    if (seriesTagDisplay && seriesTagDisplay.value) {
      const { color, value, meaning } = seriesTagDisplay;
      return (
        <div className="measurementDisplayText">
          <span style={color.Value ? { color: color.Value } : undefined}>{value}</span>
          {meaning && (
            <span className="seriesTagMeaning" style={color.Meaning ? { color: color.Meaning } : undefined}>{meaning}</span>
          )}
        </div>
      );
    }

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
