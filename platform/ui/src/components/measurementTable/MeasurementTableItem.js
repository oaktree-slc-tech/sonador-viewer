import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import {
  Button, DataRowActions, HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger, Icons, Popover, PopoverAnchor,
  PopoverContent, PopoverPortal, Tooltip as HoverTooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ohif/ui-next';
import measurementDetail, { toolDisplayName, toolIcon } from '@ohif/core/src/measurements/tools/measurementDetail';

import { OverlayTrigger } from '../overlayTrigger';
import { TableListItem } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';

import { MeasurementDetailCard } from './MeasurementDetailCard';
import { HeldSetMark, LandmarkSetCard, LandmarkSetIcon, LandmarkShape, LandmarkTypeMark } from './LandmarkSetCard';
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
const TruncatedLabel = ({ text, className = 'measurementLabel' }) => {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <HoverTooltip open={open} onOpenChange={next => setOpen(next && ref.current && ref.current.scrollWidth > ref.current.clientWidth)}>
        <TooltipTrigger asChild>
          <div ref={ref} className={className}>{text}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="measurementLabelTooltip">{text}</TooltipContent>
      </HoverTooltip>
    </TooltipProvider>
  );
};


TruncatedLabel.propTypes = {
  text: PropTypes.string.isRequired,
  className: PropTypes.string,
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


// A row read from an application document, which the Viewer shows read-only and never writes to,
// keeps the lock; the lock's hover says where the row comes from, beside a document
const ApplicationDocumentIcon = () => (
  <svg aria-hidden="true" data-cy="measurement-application-document-icon" className="measurementDocumentIcon"
    viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </svg>
);

const APPLICATION_DOCUMENT_NOTE = 'Read-only: from an application document';


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

// The detail card opens after the pointer rests on the row's value or reference line, and closes a
// moment after it leaves them and the card
const CARD_OPEN_DELAY = 300;
const CARD_CLOSE_DELAY = 150;
// A focus this soon after a pointer press on the tool icon is that press's, not the keyboard's
const POINTER_FOCUS_WINDOW = 1000;

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';
/** The elements of `root` that sequential keyboard navigation reaches, in document order */
const tabbablesIn = root => [...root.querySelectorAll(TABBABLE)]
  .filter(node => node.tabIndex >= 0 && !node.closest('[aria-hidden="true"], [hidden], [inert]'));


/**
 * The detail card's open state and the handlers that drive it: mouse hover on the trigger parts
 * (the tool icon, the value, the reference line) and on the card; focus, Enter / Space and Escape
 * on the tool icon; and a tap on the tool icon (touch, pen). One state for all parts, so moving
 * between them keeps the card open.
 *
 * The card is portalled, so its place in the tab order is set here: Tab on the icon of an open card
 * moves into the card, Shift+Tab from its first control returns to the icon, and Tab from its last
 * control continues after the icon. Escape in the card closes it and returns focus to the icon.
 */
function useDetailCard(enabled, { keepOnRow = false } = {}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const timers = useRef({});
  const press = useRef(null);
  const quietFocus = useRef(false);
  const iconRef = useRef(null);
  const cardRef = useRef(null);
  // Focus moving into the card (its toggles) keeps it open
  const intoCard = event => Boolean(cardRef.current && event.relatedTarget && cardRef.current.contains(event.relatedTarget));
  const pressed = () => press.current && Date.now() - press.current.at < POINTER_FOCUS_WINDOW ? press.current.type : null;

  const clear = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!enabled) {
      clear();
      setOpen(false);
    }
  }, [enabled]);

  const show = () => {
    clear();
    setOpen(true);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };
  const scheduleOpen = () => {
    clearTimeout(timers.current.close);
    timers.current.open = setTimeout(() => setOpen(true), CARD_OPEN_DELAY);
  };
  const scheduleClose = () => {
    clear();
    timers.current.close = setTimeout(() => setOpen(false), CARD_CLOSE_DELAY);
  };
  // Focus returned to the icon by the card does not open it again
  const focusIcon = () => {
    if (iconRef.current) {
      quietFocus.current = true;
      iconRef.current.focus();
      quietFocus.current = false;
    }
  };
  const focusAfterIcon = () => {
    const icon = iconRef.current;
    const card = cardRef.current;
    const order = icon ? tabbablesIn(icon.ownerDocument).filter(node => !(card && card.contains(node))) : [];
    const next = order[order.indexOf(icon) + 1];
    if (next) {
      next.focus();
    } else if (icon) {
      icon.blur();
    }
  };

  if (!enabled) {
    return { open: false, hoverProps: {}, rowProps: {}, iconProps: {}, cardProps: {}, anchorRef, setOpen: () => {} };
  }

  const isMouse = event => event.pointerType === 'mouse';
  const isTap = type => type === 'touch' || type === 'pen';
  const hoverProps = {
    onPointerEnter: event => isMouse(event) && scheduleOpen(),
    onPointerLeave: event => isMouse(event) && scheduleClose(),
  };
  // An open card stays open while the pointer is anywhere over its row, and closes a moment after
  // the pointer leaves the row and the card
  const rowProps = {
    onPointerOver: event => isMouse(event) && open && clearTimeout(timers.current.close),
    onPointerLeave: event => isMouse(event) && open && scheduleClose(),
  };
  const iconProps = {
    ref: iconRef,
    tabIndex: 0,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    // The focus of a tap is left to the tap's click, which toggles the card once
    onFocus: () => {
      if (!quietFocus.current && !isTap(pressed())) {
        show();
      }
    },
    onBlur: event => !intoCard(event) && scheduleClose(),
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        hide();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (open) {
          hide();
        } else {
          show();
        }
      } else if (event.key === 'Tab' && !event.shiftKey && open && cardRef.current) {
        const [first] = tabbablesIn(cardRef.current);
        if (first) {
          event.preventDefault();
          clear();
          first.focus();
        }
      }
    },
    onPointerDown: (event) => {
      press.current = { type: event.pointerType, at: Date.now() };
    },
    // A tap on the icon opens the card, a second tap closes it; the click still selects the row
    onClick: () => {
      if (isTap(pressed())) {
        press.current = null;
        setOpen(value => !value);
      }
    },
  };
  const cardProps = {
    ref: cardRef,
    onFocus: clear,
    onBlur: event => !intoCard(event) && event.relatedTarget !== iconRef.current && scheduleClose(),
    onPointerEnter: event => isMouse(event) && clear(),
    onPointerLeave: event => isMouse(event) && scheduleClose(),
    onKeyDown: (event) => {
      if (event.key !== 'Tab' || !cardRef.current) {
        return;
      }
      const controls = tabbablesIn(cardRef.current);
      const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
      if (event.target !== edge) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        focusIcon();
      } else {
        hide();
        focusAfterIcon();
      }
    },
    onEscapeKeyDown: () => {
      const inCard = cardRef.current && cardRef.current.contains(cardRef.current.ownerDocument.activeElement);
      hide();
      if (inCard) {
        focusIcon();
      }
    },
    // A tap outside closes it; a tap on the icon toggles it itself. With `keepOnRow` a press on the
    // card's own row leaves it open, so selecting the row again does not close and reopen it.
    onInteractOutside: (event) => {
      const inIcon = iconRef.current && iconRef.current.contains(event.target);
      const inRow = keepOnRow && anchorRef.current && anchorRef.current.contains(event.target);
      if (inIcon || inRow) {
        event.preventDefault();
        return;
      }
      hide();
    },
    // Opening on hover or focus leaves focus where it is
    onOpenAutoFocus: event => event.preventDefault(),
    onCloseAutoFocus: event => event.preventDefault(),
  };
  return { open, hoverProps, rowProps, iconProps, cardProps, anchorRef, setOpen };
}


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
  onViewportValuesChange,
  onLandmarkClick,
  landmarkMatch,
  regionLeadValue,
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

  // A landmark set (one row per set, read-only): its series and the number of its landmarks. A set
  // that cannot be shown is held, with a note on its index cell.
  const { landmarkSet } = measurementData;
  const heldSet = Boolean(landmarkSet && !landmarkSet.placed);
  const placedSet = Boolean(landmarkSet && landmarkSet.placed);

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
    if (!identifiers || (!isSeriesTag && !outOfPlane && !landmarkSet && identifiers.InstanceNumber === undefined)) {
      return null;
    }
    return identifiers;
  }, [refStudyInstanceUID, refSeriesInstanceUID, refSOPInstanceUID, isSeriesTag, outOfPlane, landmarkSet, metadataVersion]);

  // The measurement's detail (core measurements/tools/measurementDetail): the value line, the
  // reference line's +N and the detail card. A Series Tag has its tool icon and no card.
  const { toolType, detailSource } = measurementData;
  const detail = useMemo(() => {
    if (!detailSource || isSeriesTag) {
      return undefined;
    }
    return measurementDetail(toolType, detailSource.measurement, {
      ...detailSource.context, modality: refMeta ? refMeta.Modality : undefined, regionLeadValue,
    });
  }, [toolType, detailSource, isSeriesTag, refMeta, regionLeadValue]);
  const icon = toolIcon(isSeriesTag ? 'DICOMSRSeriesTagTool' : toolType);
  const extraCount = detail && detail.primary ? detail.extraCount : 0;

  // The card is suppressed on a row whose warning note covers it. A landmark set's card lists its
  // landmarks and its details (LandmarkSetCard).
  const cardEnabled = Boolean(detail || landmarkSet) && !(measurementData.hasWarnings && !isReadOnly);
  const card = useDetailCard(cardEnabled, { keepOnRow: Boolean(landmarkSet) });

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
    // Set visibility of the measurement; a landmark set's is the session's (core DICOMSR/landmarks)
    
    evt.stopPropagation();
    if (landmarkSet) {
      OHIF.DICOMSR.landmarks.setLandmarkSetVisible(landmarkSet.key, !measurementData.isVisible);
      return;
    }
    measurements.MeasurementApi.Instance.toggleVisibilityMeasurement(
      measurementData.measurementId, !measurementData.isVisible);
    measurements.refreshCornerstoneViewports();
  }

  const handleItemClick = (event) => {
    // Activate the measurement and jumpt to the associated image viewport. A click on a landmark
    // set's row also opens its card: one click opens it and steps once.

    if (landmarkSet && cardEnabled) {
      card.setOpen(true);
    }
    onItemClick(event, measurementData);
  };

  // The focusable index cell of an out-of-plane row, or of a placed landmark set: Enter or Space
  // activates the row, as a click on it does (an arrow goes to its nearest slice in the classic
  // viewport; a set steps to its next landmark). The card belongs to the set icon's keys.
  const onIndexKeyDown = (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
      event.preventDefault();
      onItemClick(event, measurementData);
    }
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
    const outOfPlaneClass = outOfPlane ? 'isOutOfPlane' : heldSet ? 'isOutOfPlane isHeldLandmarkSet' : '';

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
      
    const tableListItem = (
      <TableListItem
        key={measurementData.measurementId}
        itemKey={measurementData.measurementId}
        itemClass={`measurementItem group ${itemClass} ${hasWarningClass} ${outOfPlaneClass}`}
        itemIndex={itemIndex}
        itemIndexStyle={seriesTagBand(measurementData.seriesTagDisplay)}
        itemMeta={outOfPlane ? <OutOfPlaneIcon /> : heldSet ? <HeldSetMark label={t('Not shown')} /> : null}
        itemIndexProps={outOfPlane ? { tabIndex: 0, onKeyDown: onIndexKeyDown }
          : placedSet ? {
            tabIndex: 0,
            role: 'button',
            'aria-label': t('{{number}}. Next landmark of {{name}}', { number: itemIndex, name: landmarkSet.name || t('Landmark set') }),
            onKeyDown: onIndexKeyDown,
            'data-cy': 'landmark-set-index',
          }
          : heldSet ? { tabIndex: 0 } : undefined}
        renderItemIndex={outOfPlane ? renderOutOfPlaneNote : heldSet ? renderHeldSetNote : undefined}
        onItemClick={handleItemClick}
      >
        <div>
          <div className="measurementContent">
            <div className="displayTexts" {...card.hoverProps}>{getDataDisplayText()}</div>
            {/* The Segmentations panel's row controls (ui-next DataRow), packed to the right: the
                visibility toggle, the lock while locked, then the actions menu when there is one */}
            <div className="measurementStatus">
              {!heldSet && (<TooltipProvider delayDuration={500}>
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
              </TooltipProvider>)}
              {Boolean(measurementData.isLocked) && (measurementData.fromApplicationDocument ? (
                <TooltipProvider delayDuration={300}>
                  <HoverTooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="measurementLock"
                        tabIndex={0}
                        aria-label={t(APPLICATION_DOCUMENT_NOTE)}
                        data-cy="measurement-application-document"
                      >
                        <Icons.Lock data-cy="measurement-locked" aria-hidden="true" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="measurementApplicationDocumentNote" data-cy="measurement-application-document-tooltip">
                      <ApplicationDocumentIcon />
                      <span>{t(APPLICATION_DOCUMENT_NOTE)}</span>
                    </TooltipContent>
                  </HoverTooltip>
                </TooltipProvider>
              ) : (
                <span className="measurementLock"><Icons.Lock data-cy="measurement-locked" /></span>
              ))}
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
          {/* A landmark set keeps its count when its series is unavailable */}
          {(refMeta || landmarkSet) && (<div className="referenceMeta" {...card.hoverProps}>
            {refMeta && (
              <span className="refItem refSxNum"><span className="refLabel">S:</span><span className="refValue">{refMeta.SeriesNumber}</span></span>
            )}
            {refMeta && !isSeriesTag && !outOfPlane && (!landmarkSet || (placedSet && landmarkSet.domain === 'image')) && refMeta.InstanceNumber !== undefined && (
              <span className="refItem refImgNum"><span className="refLabel">I:</span><span className="refValue">{refMeta.InstanceNumber}</span></span>
            )}
            {refMeta && outOfPlane && outOfPlane.view && (
              <span className="refItem refView"><span className="refLabel">View:</span><span className="refValue">{outOfPlane.view}</span></span>
            )}
            {refMeta && !heldSet && (
              <span className="refItem refSxModality"><span className="refLabel">Modality:</span><span className="refValue">{refMeta.Modality}</span></span>
            )}
            {heldSet && <span className="refItem landmarkNotShown" data-cy="landmark-set-not-shown">{t('Not shown')}</span>}
            {landmarkSet && landmarkCountPill()}
            {refMeta && extraCount > 0 && (
              <span className="refMore" aria-hidden="true" data-cy="measurement-detail-count">+{extraCount}</span>
            )}
          </div>)}
          {landmarkSet && landmarkMatch ? (
            <div className="measurementLabel landmarkMatches" data-cy="landmark-set-matches" {...card.hoverProps}>
              <span className="landmarkMatchesLabel">{t('Matches:')}</span> {landmarkMatch}
            </div>
          ) : measurementData && Boolean((measurementData.label || '').replace('...', '')) && (
            landmarkSet ? (
              <div {...card.hoverProps}><TruncatedLabel text={measurementData.label} /></div>
            ) : (
              <TruncatedLabel text={t(measurementData.label, { keySeparator: '>', nsSeparator: '|', })} />
            )
          )}
          {placedSet && landmarkSet.position !== null && landmarkSet.position !== undefined && currentLandmarkLine()}
          {isSelected && measurementData.isVisible && !Boolean(isReadOnly) && <div className="rowActions">{actionButtons}</div>}
        </div>
      </TableListItem>
    );

    if (!cardEnabled) {
      return tableListItem;
    }
    return (
      <Popover open={card.open} onOpenChange={card.setOpen}>
        <PopoverAnchor asChild>
          <div className="measurementDetailAnchor" ref={card.anchorRef} {...(landmarkSet ? card.rowProps : {})}>{tableListItem}</div>
        </PopoverAnchor>
        <PopoverPortal>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            avoidCollisions
            className="annotationHoverCard measurementDetailCard"
            {...card.cardProps}
          >
            {getDetailCard()}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  };

  const getDetailCard = () => {
    if (landmarkSet) {
      return getLandmarkSetCard();
    }
    // The detail card's content: the row's measurement in full
    const series = refMeta && [refMeta.SeriesNumber, refMeta.SeriesDescription].filter(value => value !== undefined && value !== '').join(' \u00B7 ');
    const study = DicomMetadataStore && refSeriesInstanceUID
      ? DicomMetadataStore.getSeries(refStudyInstanceUID, refSeriesInstanceUID) : undefined;
    // The image is named by its Instance Number, which is not its position in the series: the
    // series' image count goes with the series
    const instanceCount = study && study.instances ? study.instances.length : undefined;
    const seriesLine = [series, instanceCount ? t('{{count}} images', { count: instanceCount }) : '']
      .filter(Boolean).join(' \u00B7 ');
    const image = refMeta && refMeta.InstanceNumber !== undefined ? String(refMeta.InstanceNumber) : undefined;
    const reference = refMeta ? {
      series: seriesLine, image, view: outOfPlane ? outOfPlane.view : undefined, modality: refMeta.Modality,
    } : undefined;
    const { customColor } = measurementData;
    return (
      <MeasurementDetailCard
        detail={detail}
        rowNumber={itemIndex}
        isPending={Boolean(measurementData.isPending)}
        isSaved={Boolean(isReadOnly)}
        editable={Boolean(detail.viewportToggles && measurementData.isPending && !isReadOnly && detail.primary)}
        disabled={!measurementData.isVisible}
        reference={reference}
        outOfPlaneNote={outOfPlane && outOfPlane.frameOfReferenceLoaded !== false ? outOfPlaneNoteText(outOfPlane, t) : undefined}
        meta={{ location: measurementData.location, description: measurementData.description }}
        appearance={customColor ? { line: customColor.line, text: customColor.text } : undefined}
        onViewportValuesChange={keys => onViewportValuesChange && onViewportValuesChange(measurementData, keys)}
      />
    );
  };

  // A landmark set's count pill: the number of its landmarks, or the current landmark's position while
  // the set holds it
  const landmarkCountPill = () => {
    const position = placedSet && landmarkSet.position !== null && landmarkSet.position !== undefined ? landmarkSet.position : null;
    if (position === null) {
      return (
        <span className="refItem refLandmarkCount" data-cy="landmark-set-count">
          {landmarkSet.count === 1 ? t('1 landmark') : t('{{count}} landmarks', { count: landmarkSet.count })}
        </span>
      );
    }
    const help = t('Landmark {{position}} of {{count}}. Select the row again for the next.', { position: position + 1, count: landmarkSet.count });
    return (
      <TooltipProvider delayDuration={300}>
        <HoverTooltip>
          <TooltipTrigger asChild>
            <span className="refItem refLandmarkCount isPosition" data-cy="landmark-set-count" aria-label={help}>
              {t('{{position}} of {{count}}', { position: position + 1, count: landmarkSet.count })}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="measurementLabelTooltip" data-cy="landmark-set-position-help">{help}</TooltipContent>
        </HoverTooltip>
      </TooltipProvider>
    );
  };

  // The line under a set that holds the current landmark, docked in the row as its actions are: its
  // marker shape in its colour, then its name (the whole name and its second line on hover when it
  // does not fit), or its type alone (an outlined mark) when it has none; then the control that
  // clears it
  const currentLandmarkLine = () => {
    const landmark = landmarkSet.landmarks[landmarkSet.position];
    if (!landmark) {
      return null;
    }
    const full = [landmark.name, landmark.detail].filter(Boolean).join(' \u00B7 ');
    const clear = (event) => {
      event.stopPropagation();
      // The control goes with the line: focus it held moves to the row's step control first, so the
      // keyboard keeps its place in the panel
      const button = event.currentTarget;
      if (button.ownerDocument.activeElement === button) {
        const step = button.closest('.tableListItem') && button.closest('.tableListItem').querySelector('[data-cy="landmark-set-index"]');
        if (step) {
          step.focus();
        }
      }
      OHIF.DICOMSR.landmarks.clearCurrentLandmark();
    };
    return (
      <div className="landmarkCurrent" data-cy="landmark-set-current">
        <LandmarkShape shape={landmark.shape} color={landmark.line} />
        {landmark.name
          ? <TruncatedLabel text={full} className="landmarkCurrentName" />
          : <LandmarkTypeMark text={t(landmark.typeText)} />}
        <button
          type="button"
          className="landmarkCurrentClear"
          aria-label={t('Clear the current landmark')}
          title={t('Clear the current landmark')}
          data-cy="landmark-set-current-clear"
          onClick={clear}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    );
  };

  // The series line of a set's card: its series with the series' image count; a set listed under
  // no series names the series it stores, else none
  const landmarkSeriesLine = () => {
    const identifiers = refMeta || (landmarkSet.sourceSeries && OHIF.utils.referenceIdentifiers(DicomMetadataStore, {
      StudyInstanceUID: refStudyInstanceUID, SeriesInstanceUID: landmarkSet.sourceSeries,
    }));
    if (!identifiers) {
      return undefined;
    }
    const seriesUID = refMeta ? refSeriesInstanceUID : landmarkSet.sourceSeries;
    const series = DicomMetadataStore && typeof DicomMetadataStore.getSeries === 'function' && seriesUID
      ? DicomMetadataStore.getSeries(refStudyInstanceUID, seriesUID) : undefined;
    const count = series && series.instances ? series.instances.length : undefined;
    return [identifiers.SeriesNumber, identifiers.SeriesDescription, count ? t('{{count}} images', { count }) : '']
      .filter(value => value !== undefined && value !== null && value !== '').join(' \u00B7 ');
  };

  const getLandmarkSetCard = () => {
    const image = landmarkSet.domain === 'image' && refMeta && refMeta.InstanceNumber !== undefined
      ? [String(refMeta.InstanceNumber), Number(landmarkSet.frameNumber) > 1 ? t('frame {{number}}', { number: landmarkSet.frameNumber }) : '']
        .filter(Boolean).join(' \u00B7 ')
      : undefined;
    return (
      <LandmarkSetCard
        measurementData={measurementData}
        rowNumber={itemIndex}
        series={landmarkSeriesLine()}
        image={image}
        heldNote={landmarkSet.note ? t(landmarkSet.note) : undefined}
        onChoose={(event, index) => onLandmarkClick && onLandmarkClick(event, measurementData, index)}
      />
    );
  };

  const toolIconElement = () => {
    // The icon of the tool that drew the measurement, as on its toolbar button; with a detail card,
    // it opens the card (focus, or a tap). A landmark set's is the set icon.
    if (landmarkSet) {
      return (
        <span
          key="toolIcon"
          className="measurementToolIcon landmarkSetIcon"
          role="button"
          aria-label={t('Landmark set')}
          data-cy="measurement-tool-icon"
          {...card.iconProps}
        >
          <LandmarkSetIcon />
        </span>
      );
    }
    if (!icon) {
      return null;
    }
    const name = isSeriesTag ? t('Series Tag') : t(toolDisplayName(toolType) || toolType || '');
    // The reference line's +N, which is hidden from assistive technology, describes the icon
    const countId = refMeta && extraCount > 0 ? `measurement-detail-count-${measurementData.measurementId}` : undefined;
    return (
      <span
        key="toolIcon"
        className="measurementToolIcon"
        role={cardEnabled ? 'button' : 'img'}
        aria-label={name}
        aria-describedby={countId}
        data-cy="measurement-tool-icon"
        {...card.iconProps}
      >
        <Icon name={icon} width="18px" height="18px" aria-hidden="true" />
        {countId && (
          <span id={countId} className="visuallyHidden">{t('{{count}} more values', { count: extraCount })}</span>
        )}
      </span>
    );
  };

  const getDataDisplayText = () => {
    // Retrieve the display text for the measurement 

    const { seriesTagDisplay } = measurementData;
    if (seriesTagDisplay && seriesTagDisplay.value) {
      const { color, value, meaning } = seriesTagDisplay;
      return (
        <div className={`measurementDisplayText ${icon ? 'hasToolIcon' : ''}`}>
          {toolIconElement()}
          <span style={color.Value ? { color: color.Value } : undefined}>{value}</span>
          {meaning && (
            <span className="seriesTagMeaning" style={color.Meaning ? { color: color.Meaning } : undefined}>{meaning}</span>
          )}
        </div>
      );
    }

    // A landmark set: its icon, its swatch (its Line colour, then its Text colour) and its name, which
    // takes up to two lines
    if (landmarkSet) {
      return (
        <div className="landmarkSetValue">
          {toolIconElement()}
          <span className="measurementColorIndicator" data-cy="landmark-set-swatch">
            <span className="measurementColorIndicatorLine" style={{ backgroundColor: landmarkSet.colors.line }} />
            <span className="measurementColorIndicatorText" style={{ backgroundColor: landmarkSet.colors.text }} />
          </span>
          <span className={`measurementDisplayText landmarkSetName ${landmarkSet.name ? '' : 'isUnnamed'}`}>
            {landmarkSet.name || t('Landmark set')}
          </span>
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

    return [toolIconElement(), colorIndicator, ...measurementData.data.map((data, index) => {
      // The value from the measurement's detail (the region tools' lead value), else the tool's own
      const text = index === 0 && detail && detail.primary ? detail.primary.text : data.displayText;
      return (
        <div key={`displayText_${index}`} className="measurementDisplayText">
          {text || '...'}
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

  // The note of a held landmark set, in the form of the out-of-plane note: why it is not shown, and the
  // series it was made on (Unknown when it records none)
  const getHeldSetNote = () => {
    const stored = landmarkSet.sourceSeries && OHIF.utils.referenceIdentifiers(DicomMetadataStore, {
      StudyInstanceUID: refStudyInstanceUID, SeriesInstanceUID: landmarkSet.sourceSeries,
    });
    const series = stored && [stored.SeriesNumber, stored.SeriesDescription].filter(value => value !== undefined && value !== '').join(' ');
    return (
      <div className="warningContent">
        <p>{t(landmarkSet.note)}</p>
        <div className="outOfPlaneNoteItem"><span className="refLabel">{t('Series')}:</span> {series || t('Unknown')}</div>
      </div>
    );
  };

  const renderHeldSetNote = indexCell => (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>{indexCell}</HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent side="left" align="center" sideOffset={0} className="outOfPlaneNoteCard" data-cy="landmark-set-held-note">
          <Tooltip placement="left" className="in tooltip-warning tooltip-outOfPlane" id="tooltip-left">
            <div className="warningTitle">{t('Landmark set not shown')}</div>
            {getHeldSetNote()}
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
  /** Set the values a pending measurement's viewport label shows: (measurementData, keys) */
  onViewportValuesChange: PropTypes.func,
  /** Choose a named landmark of a landmark set's row from its card: (event, measurementData, index) */
  onLandmarkClick: PropTypes.func,
  /** What a search matched among a landmark set's landmarks ("Tear drop (2)") */
  landmarkMatch: PropTypes.string,
  /** The region tools' lead value ('area' or 'mean') */
  regionLeadValue: PropTypes.string,
  itemClass: PropTypes.string,
  itemIndex: PropTypes.number,
  tagBtnLabel: PropTypes.string,
  tagBtnHint: PropTypes.string,
  descriptionBtnLabel: PropTypes.string,
  deleteBtnLabel: PropTypes.string,
  isSelected: PropTypes.bool,
};



export { MeasurementTableItem };
