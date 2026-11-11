import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import {
  Button, DataRowActions, HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger, Icons, Tooltip as HoverTooltip,
  TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ohif/ui-next';

import { OverlayTrigger } from '../overlayTrigger';
import { TableListItem } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';

import { subscribeSeriesMetadata } from './metadataEventConcerns';
import './MeasurementTableItem.styl';
import './VisibilityToggle.styl';

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


// An out-of-plane measurement is marked in its index cell: a cube under the number
const OutOfPlaneIcon = () => (
  <span className="outOfPlaneIcon">
    <svg role="img" aria-label="3D measurement" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </svg>
  </span>
);


/**
 * Where an out-of-plane measurement is shown: the view it was drawn in when it records one (nothing
 * is inferred without it); points in no common plane are drawn in the 3D views only, and the MPR
 * view is centred on them.
 */
const outOfPlaneNoteText = (outOfPlane, t) => {
  if (outOfPlane.planar === false) {
    return t('Its points lie in no common plane: shown in the 3D views only. Selecting it in an MPR view of its frame of reference centres the panes on it.');
  }
  const view = outOfPlane.viewName;
  return view ? t('Drawn on {{view}} plane, shown in the MPR and 3D views.', { view }) : t('Shown in the MPR and 3D views.');
};

const MeasurementTableItem = ({
  // Render measurement data and actions

  onDelete,
  itemIndex,
  measurementData,
  onRelabel,
  onItemClick,
  onEditDescription,
  onOpenInMpr,
  onToggleLock,
  onLineTextColor,
  itemClass,
  tagBtnLabel = 'Location',
  tagBtnHint = 'Set anatomic location',
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

  // An out-of-plane measurement (on no image) shows its view in place of the image
  const { outOfPlane } = measurementData;

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

    // A measurement's line includes its image, so it needs the instance; a Series Tag and an
    // out-of-plane measurement need only their series
    if (!identifiers || (!isSeriesTag && !outOfPlane && identifiers.InstanceNumber === undefined)) {
      return null;
    }
    return identifiers;
  }, [refStudyInstanceUID, refSeriesInstanceUID, refSOPInstanceUID, isSeriesTag, outOfPlane, metadataVersion]);

  const getActionButton = (btnLabel, onClickCallback, hint) => {
    const button = (
      <button key={btnLabel} className="btnAction" onClick={onClickCallback} aria-label={hint ? t(hint) : undefined}>
        <span style={{ marginRight: '4px' }}>
          <Icon name="edit" width="14px" height="14px" />
        </span>
        {t(btnLabel)}
      </button>
    );
    if (!hint) {
      return button;
    }
    return (
      <TooltipProvider key={btnLabel} delayDuration={300}>
        <HoverTooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="bottom" className="measurementLabelTooltip">{t(hint)}</TooltipContent>
        </HoverTooltip>
      </TooltipProvider>
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

  const onOpenInMprClick = (event) => {
    // Open the MPR view at an out-of-plane measurement

    event.preventDefault();
    event.stopPropagation();
    onOpenInMpr(event, measurementData);
  };

  // The actions menu of a pending measurement (the Segmentations panel's row menu): its line and
  // text colors and its lock. A saved measurement, or one read from a report, is part of a stored
  // set and cannot be changed, and a measurement of a tool that cannot be saved has no record they
  // apply to: neither has a menu.
  const rowActions = () => {
    if (isReadOnly || !measurementData.isPending) {
      return [];
    }
    const actions = [];
    if (typeof onLineTextColor === 'function') {
      actions.push(
        { id: 'LineColor', label: t('Line Color'), icon: <Icons.ColorChange className="text-foreground" />,
          onClick: event => onLineTextColor(event, measurementData, 'line'), dataCY: 'LineColor' },
        { id: 'TextColor', label: t('Text Color'), icon: <Icons.ColorChange className="text-foreground" />,
          onClick: event => onLineTextColor(event, measurementData, 'text'), dataCY: 'TextColor' },
      );
    }
    if (typeof onToggleLock === 'function') {
      actions.push({
        id: 'Lock', label: measurementData.isLocked ? t('Unlock') : t('Lock'),
        icon: <Icons.Lock className="text-foreground" />,
        onClick: event => onToggleLock(event, measurementData), dataCY: 'LockToggle',
      });
    }
    return actions;
  };

  const getTableListItem = () => {
    // Retrieve the table list component

    const hasWarningClass = measurementData.hasWarnings && !isReadOnly ? 'hasWarnings' : '';
    const outOfPlaneClass = outOfPlane ? 'isOutOfPlane' : '';

    const actionButtons = [];

    if (typeof onRelabel === 'function') {
      const relabelButton = getActionButton(tagBtnLabel, onRelabelClick, tagBtnHint);
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
        itemClass={`measurementItem group ${itemClass} ${hasWarningClass} ${outOfPlaneClass}`}
        itemIndex={itemIndex}
        itemIndexStyle={seriesTagBand(measurementData.seriesTagDisplay)}
        itemMeta={outOfPlane ? <OutOfPlaneIcon /> : null}
        itemIndexProps={outOfPlane ? { tabIndex: 0 } : undefined}
        renderItemIndex={outOfPlane ? renderOutOfPlaneNote : undefined}
        onItemClick={handleItemClick}
      >
        <div>
          <div className="measurementContent">
            <div className="displayTexts">{getDataDisplayText()}</div>
            {/* The Segmentations panel's row controls (ui-next DataRow), packed to the right: the
                visibility toggle, the lock while locked, then the actions menu when there is one */}
            <div className="measurementStatus">
              <TooltipProvider delayDuration={500}>
                <HoverTooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`annotationVisibilityToggle ${measurementData.isVisible ? '' : 'isHidden'}`}
                      data-cy="measurement-visibility-toggle"
                      aria-label={measurementData.isVisible ? t('Hide') : t('Show')}
                      onClick={onToggleVisibility}
                    >
                      {measurementData.isVisible ? <Icons.Hide /> : <Icons.Show />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" data-cy="measurement-visibility-tooltip">
                    {measurementData.isVisible ? t('Hide') : t('Show')}
                  </TooltipContent>
                </HoverTooltip>
              </TooltipProvider>
              {Boolean(measurementData.isLocked) && (
                <span className="measurementLock"><Icons.Lock data-cy="measurement-locked" /></span>
              )}
              {rowActions().length > 0 && (
                // The panel has no ui-next theme scope: the trigger is reset as the visibility toggle
                // is, and the menu (portalled to the body) takes the Segmentations panel theme's
                // popover surface, border and type
                <DataRowActions
                  actions={rowActions()}
                  isSelected={isSelected}
                  className="measurementActions appearance-none border-0 bg-transparent p-0"
                  contentClassName="bg-[var(--ui-gray-darker)] border-[var(--ui-border-color)] font-[family-name:Inter,system-ui,sans-serif]"
                />
              )}
              {/* Neither a lock nor a menu (a tool that cannot be saved): the toggle keeps the
                  column of the all-annotations toggle, second from the right */}
              {!measurementData.isLocked && rowActions().length === 0 && (
                <span className="measurementControlSpacer" aria-hidden="true" />
              )}
            </div>
          </div>
          {refMeta && (<div className="referenceMeta">
            <span className="refItem refSxNum"><span className="refLabel">S:</span><span className="refValue">{refMeta.SeriesNumber}</span></span>
            {!isSeriesTag && !outOfPlane && (
              <span className="refItem refImgNum"><span className="refLabel">I:</span><span className="refValue">{refMeta.InstanceNumber}</span></span>
            )}
            {outOfPlane && outOfPlane.view && (
              <span className="refItem refView"><span className="refLabel">View:</span><span className="refValue">{outOfPlane.view}</span></span>
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

    // A measurement drawn in custom colors is marked as a segment row marks its color: its line
    // color, or its line color and its text color side by side
    const { customColor } = measurementData;
    const colorIndicator = customColor && (
      <span key="colorIndicator" className="measurementColorIndicator" data-cy="measurement-color-indicator">
        <span className="measurementColorIndicatorLine" style={{ backgroundColor: customColor.line }} />
        {customColor.text && <span className="measurementColorIndicatorText" style={{ backgroundColor: customColor.text }} />}
      </span>
    );

    return [colorIndicator, ...measurementData.data.map((data, index) => {
      return (
        <div key={`displayText_${index}`} className="measurementDisplayText">
          {data.displayText ? data.displayText : '...'}
        </div>
      );
    })];
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

  const getOutOfPlaneNote = () => {
    // The note of an out-of-plane measurement, in the form of the warning note: the plane it was
    // drawn on, in the classic viewport the action that opens it in the MPR, then its view and series
    if (!outOfPlane.frameOfReferenceLoaded) {
      return <div className="warningContent">{t("No loaded series shares this measurement's frame of reference.")}</div>;
    }
    const series = refMeta && [refMeta.SeriesNumber, refMeta.SeriesDescription].filter(value => value !== undefined && value !== '').join(' ');
    return (
      <div className="warningContent">
        <p>{outOfPlaneNoteText(outOfPlane, t)}</p>
        {outOfPlane.inClassicViewport && typeof onOpenInMpr === 'function' && (
          <div className="outOfPlaneNoteLink"><a href="#" className="outOfPlaneOpenMpr" onClick={onOpenInMprClick}>{t('Open in MPR')}</a></div>
        )}
        {outOfPlane.view && <div className="outOfPlaneNoteItem"><span className="refLabel">{t('View')}:</span> {outOfPlane.view}</div>}
        {series && <div className="outOfPlaneNoteItem"><span className="refLabel">{t('Series')}:</span> {series}</div>}
      </div>
    );
  };

  // The note opens on the index cell only (hover or keyboard focus), and stays open while the
  // pointer is on it, so its action can be reached. The card only places the warning note.
  const renderOutOfPlaneNote = indexCell => (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>{indexCell}</HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent side="left" align="center" sideOffset={0} className="outOfPlaneNoteCard" data-cy="out-of-plane-note">
          <Tooltip placement="left" className="in tooltip-warning tooltip-outOfPlane" id="tooltip-left">
            <div className="warningTitle">{t('3D measurement')}</div>
            {getOutOfPlaneNote()}
          </Tooltip>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );

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
  onOpenInMpr: PropTypes.func,
  onToggleLock: PropTypes.func,
  onLineTextColor: PropTypes.func,
  itemClass: PropTypes.string,
  itemIndex: PropTypes.number,
  tagBtnLabel: PropTypes.string,
  tagBtnHint: PropTypes.string,
  descriptionBtnLabel: PropTypes.string,
  deleteBtnLabel: PropTypes.string,
  isSelected: PropTypes.bool,
};



export { MeasurementTableItem };
