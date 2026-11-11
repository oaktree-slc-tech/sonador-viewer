import _ from 'lodash';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Icons, Label, PanelSection, ScrollArea, Switch,
  Tooltip as HelpTag, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ohif/ui-next';

import { Icon } from './../../elements/Icon';

import { OverlayTrigger } from '../overlayTrigger';
import { TableList } from '../tableList';
import { Tooltip } from '../tooltip';

import { MeasurementTableItem } from './MeasurementTableItem';
import { AnnotationsVisibilityRow } from './AnnotationsVisibilityRow';
import { filterGroups, groupRowsBySeries, queryWords, seriesAnnotationTypes, seriesEntries } from './annotationsOrganization';
import reconcileSearchVisibility from './searchVisibility';

const { measurements, log } = OHIF;
const { MeasurementApi } = measurements;

import './MeasurementTable.styl';

// "Group by series" is kept per browser. The other display settings, the search and the collapsed
// series last while the table is mounted: they reset when another panel is chosen or the table is
// reloaded
const GROUP_BY_SERIES_KEY = 'sonador-annotations-group-by-series';

function readGroupBySeries() {
  try {
    return window.localStorage.getItem(GROUP_BY_SERIES_KEY) === 'true';
  } catch (error) {
    return false;
  }
}

function writeGroupBySeries(value) {
  try {
    window.localStorage.setItem(GROUP_BY_SERIES_KEY, value ? 'true' : 'false');
  } catch (error) {
    // Storage unavailable: the setting lasts while the table is mounted
  }
}

/** A series sub-group's heading, translated when it is generated ("Series 4", "Series Unavailable") */
const seriesLabel = (series, t) => (series.labelKey ? t(series.labelKey, series.labelValues) : series.label);

/** The rows of a group collection */
const rowsOf = groups => (groups || []).flatMap(group => (group && group.measurements) || []);


/**
 * A series sub-group's hover card, after the study browser's series thumbnail without its image:
 * the series title; a table of the series' annotation types and counts across every group, the
 * pending ones on their own lines marked "Pending"; then the series number and instance count (the
 * thumbnail's stacked-squares glyph) at the left and the modality at the right. The Series
 * Unavailable group says why its measurements are there instead.
 */
function SeriesCard({ series, types, t }) {
  const unavailable = Boolean(series.help);
  const hasNumber = series.seriesNumber !== undefined && series.seriesNumber !== null && !Number.isNaN(series.seriesNumber);

  return (
    <TooltipContent side="right" align="start" sideOffset={8} className="w-64 max-w-xs whitespace-normal" data-cy="series-group-card">
      <div className="font-semibold leading-snug break-words">{seriesLabel(series, t)}</div>
      {types.length > 0 && (
        <table className="seriesAnnotationTypes mt-3 w-full text-xs" data-cy="series-annotation-types">
          <tbody>
            {types.map(({ name, pending, count }) => (
              <tr key={`${pending ? 'pending' : 'saved'}:${name}`}>
                <td>
                  {name}
                  {pending && <span className="seriesAnnotationPending">{t('Pending')}</span>}
                </td>
                <td className="text-right tabular-nums">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unavailable ? (
        <div className="mt-2 text-xs opacity-80">{t(series.help)}</div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs opacity-80">
          <div className="flex items-center gap-3">
            {hasNumber && <span><span className="font-black">S:</span> {series.seriesNumber}</span>}
            {series.instanceCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="seriesFramesGlyph" aria-hidden="true" />
                {series.instanceCount}
              </span>
            )}
          </div>
          {series.modality && <span className="font-black">{series.modality}</span>}
        </div>
      )}
    </TooltipContent>
  );
}


const MeasurementTable = ({
  server,
  measurementCollection,
  servicesManager,
  viewports,
  overallWarnings = { warningList: [] },
  timepoints,
  onItemClick,
  onRelabelClick,
  onDeleteClick,
  onEditDescriptionClick,
  onOpenInMprClick,
  onToggleLockClick,
  onLineTextColorClick,
  selectedMeasurementId,
  saveFunction,
  onSaveComplete,
  eventTimeout = 50,
  isOpen = true,
}) => {
  // Unpack references to services  
  const { displaySetService } = servicesManager.services;
  
  const { t } = useTranslation();
  const measurementApi = MeasurementApi.Instance;

  // State flags for the measurement collection, selected key, and save pending attributes
  const [activeDisplaySet, setActiveDisplaySet] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [savePending, setSavePending] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState([]);

  // Display settings (the drawer under the Annotations header) and the search
  const [showSettings, setShowSettings] = useState(false);
  const [groupBySeries, setGroupBySeriesState] = useState(readGroupBySeries);
  const [applySearchToViews, setApplySearchToViews] = useState(false);
  const [collapsedSeries, setCollapsedSeries] = useState([]);
  const [query, setQuery] = useState('');
  const searching = queryWords(query).length > 0;

  const setGroupBySeries = (value) => {
    setGroupBySeriesState(value);
    writeGroupBySeries(value);
  };

  // Every measurement by series (the measurement API's shared query), for the series hover cards;
  // computed once per change of the measurements
  const measurementsBySeries = useMemo(
    () => (measurementApi && typeof measurementApi.getMeasurementsBySeries === 'function'
      ? measurementApi.getMeasurementsBySeries() : new Map()),
    [measurementCollection]
  );

  // The groups with their matching rows; every group while there is no search
  const listedGroups = filterGroups(measurementCollection, query);

  // With "Filter annotations in imaging viewports", the annotations the search leaves out are
  // hidden in the views too while the panel is open, and shown again when they match again, the
  // search or the setting is cleared, or the panel closes. A later global choice (every annotation
  // shown or hidden at once, from the panel or View > Annotations) takes them over: after Hide All
  // they stay hidden when the filter goes. Show All while the filter applies shows the matching
  // annotations only: the filter hides the others again.
  const hiddenBySearch = useRef(new Set());
  const allRows = rowsOf(measurementCollection);
  const matchingIds = rowsOf(listedGroups).map(row => row.measurementId);
  const latest = useRef({});
  const filterActive = isOpen && applySearchToViews && searching;
  latest.current = { allRows, matchingIds, filterActive };
  const syncSearchVisibility = (active, rows = latest.current.allRows) => {
    const { hide, show, hiddenBySearch: next } = reconcileSearchVisibility({
      rows,
      matching: new Set(latest.current.matchingIds),
      active,
      hiddenBySearch: hiddenBySearch.current,
    });
    hiddenBySearch.current = next;
    if (hide.length || show.length) {
      hide.forEach(id => measurementApi.toggleVisibilityMeasurement(id, false));
      show.forEach(id => measurementApi.toggleVisibilityMeasurement(id, true));
      measurements.refreshCornerstoneViewports();
    }
  };
  useEffect(() => {
    syncSearchVisibility(filterActive);
  }, [filterActive, matchingIds.join('|'), allRows.map(row => row.measurementId).join('|')]);
  useEffect(() => {
    const removeListener = typeof MeasurementApi.addAllVisibilityListener === 'function'
      ? MeasurementApi.addAllVisibilityListener((visibility) => {
        hiddenBySearch.current = new Set();
        if (visibility && latest.current.filterActive) {
          // Every annotation was just shown; the rows still hold their earlier visibility
          syncSearchVisibility(true, latest.current.allRows.map(row => ({ ...row, isVisible: true })));
        }
      })
      : undefined;
    return () => {
      if (removeListener) {
        removeListener();
      }
      // Leaving the panel shows what the search hid
      syncSearchVisibility(false);
    };
  }, []);

  const pendingCount = useMemo(() => {
    // Calculate the number of pending measurements

    return _.chain(measurementCollection).flatMap('measurements').filter(m => {
      return Boolean(m) && (m.isDirty || !m.isReadOnly) && !Boolean(m.hasWarnings);
    }).size().value();    

  }, [measurementCollection]);


  useEffect(() => {
    let displayset_activated_subscription;
    const _viewport0 = viewports.viewportSpecificData[viewports.activeViewportIndex];
    if (_viewport0 && _viewport0.displaySetInstanceUID) {
      setActiveDisplaySet(_viewport0.displaySetInstanceUID);
    }

    if (displaySetService) {

      // Update active display set state variable on change
      displayset_activated_subscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SET_ACTIVATED, ({  displaySetInstanceUID, activeViewportIndex }) => {
          setActiveDisplaySet(displaySetInstanceUID);
        });
    }

    return () => {
      // Unsubscribe from services
      if (displayset_activated_subscription) displayset_activated_subscription.unsubscribe();
    }
  }, []);

  
  useEffect(() => {
    // Update state of savePending based on the count of pending measurements
    if (pendingCount > 0) {
      setTimeout(() => setSavePending(true), eventTimeout);
    } else {
      setTimeout(() => setSavePending(false), eventTimeout);
    }
  }, [pendingCount])


  const handleItemClick = (event, measurementData) => {
    // Activate the clicked item
    setSelectedKey(measurementData.measurementId);

    if (onItemClick) {
      onItemClick(event, measurementData);
    }
  };

  const handleSave = async () => {
    // Save measurements to DICOM-SR

    if (saveFunction) {
      try {
        const result = await saveFunction();
        if (onSaveComplete) {
          onSaveComplete({
            title: result.title || 'STOW SR',
            message: result.message,
            // A partial save is a warning (DICOMSR saveResultSummary)
            type: result.type || 'success',
          });
        }
      } catch (error) {
        if (onSaveComplete) {
          onSaveComplete({
            title: error.title || 'STOW SR',
            message: error.message,
            type: error.cancelled ? 'warning' : 'error',
          });
        }
      }
    }
  };

  const getMeasurements = (measureGroup) => {
    // Map measurements from the measurements collections to table items

    let displaySetSeriesInstanceUID;
    const { displaySetService } = servicesManager.services;
    if (displaySetService && activeDisplaySet) {

      // Retrieve active series instance UID from displaySet
      const ds = displaySetService.getDisplaySetByUID(activeDisplaySet);
      if (ds) {
        displaySetSeriesInstanceUID = ds.SeriesInstanceUID;
      }
    }

    return measureGroup.measurements.map((measurement, index) => {
      const _classes = [];
      const key = measurement.measurementId;
      const itemIndex = measurement.itemNumber || index + 1;
      const isSelected = selectedKey === key;
      if (isSelected) {
        _classes.push('selected')
      }

      const isActive = displaySetSeriesInstanceUID && measurement.refSeriesInstanceUID == displaySetSeriesInstanceUID;
      if (isActive) {
        _classes.push('active');
      }

      const itemClass = _classes.join(' ');

      if ((!measurement.isReadOnly && !measurement.hasWarnings) && !savePending) {
        setTimeout(() => setSavePending(true), eventTimeout);
      }

      return (
        <MeasurementTableItem
          key={key}
          itemIndex={itemIndex}
          itemClass={itemClass}
          measurementData={measurement}
          onItemClick={handleItemClick}
          onRelabel={onRelabelClick}
          onDelete={onDeleteClick}
          onEditDescription={onEditDescriptionClick}
          onOpenInMpr={onOpenInMprClick}
          onToggleLock={onToggleLockClick}
          onLineTextColor={onLineTextColorClick}
          isSelected={isSelected}
          isActive={isActive}
        />
      );
    });
  };

  const getCustomHeader = (measureGroup) => {
    return (
      <>
        <div className="tableListHeaderTitle">{t(measureGroup.groupName)}</div>
        {measureGroup.maxMeasurements && (
          <div className="maxMeasurements">
            {t('MAX')} {measureGroup.maxMeasurements}
          </div>
        )}
        <div className="numberOfItems">
          {searching && measureGroup.totalCount !== undefined
            ? t('{{count}} of {{total}}', { count: measureGroup.measurements.length, total: measureGroup.totalCount })
            : measureGroup.measurements.length}
        </div>
      </>
    );
  };

  const groupKey = (measureGroup, idx) => measureGroup.groupId || `group-${idx}`;

  const seriesKey = (measureGroup, idx, series) => `${groupKey(measureGroup, idx)}::${series.key}`;

  const getSeriesGroups = (measureGroup, idx) => {
    // A group's rows by series (annotationsOrganization.groupRowsBySeries), each a collapsible
    // sub-section with the group's own +/- control, open unless the user has collapsed it
    const seriesGroups = groupRowsBySeries(measureGroup.measurements);
    const keys = seriesGroups.map(series => seriesKey(measureGroup, idx, series));

    return (
      <Accordion
        type="multiple"
        className="measurementSeriesGroups"
        value={keys.filter(key => !collapsedSeries.includes(key))}
        onValueChange={(open) => setCollapsedSeries(previous => [
          ...previous.filter(key => !keys.includes(key)),
          ...keys.filter(key => !open.includes(key)),
        ])}
      >
        {seriesGroups.map(series => (
          <AccordionItem key={series.key} value={seriesKey(measureGroup, idx, series)} className="measurementSeriesGroup">
            <TooltipProvider delayDuration={500}>
              <HelpTag>
                <AccordionTrigger asChild>
                  <TooltipTrigger asChild>
                    <button type="button" className="measurementSeriesHeader">
                      <span className="measurementSeriesTitle">{seriesLabel(series, t)}</span>
                      <span className="measurementSeriesCount">{series.measurements.length}</span>
                      <span className="measurementGroupToggle" aria-hidden="true">
                        <Icons.Minus className="measurementGroupCollapse" />
                        <Icons.Plus className="measurementGroupExpand" />
                      </span>
                    </button>
                  </TooltipTrigger>
                </AccordionTrigger>
                <SeriesCard series={series} types={seriesAnnotationTypes(seriesEntries(measurementsBySeries, series.key))} t={t} />
              </HelpTag>
            </TooltipProvider>
            <AccordionContent>
              <TableList headless>{getMeasurements(series)}</TableList>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  const getMeasurementsGroups = () => {
    // Each group (Measurements, Findings, ...) is a collapsible sub-section of Annotations. Groups
    // are open unless the user has collapsed them, so a group that appears later starts open.
    // While a search is active only the groups with a match are listed.
    if (searching && !listedGroups.length) {
      return (
        <div className="annotationsNoMatch" data-cy="annotations-no-match">
          {t('No annotations match \u201C{{query}}\u201D', { query: query.trim() })}
        </div>
      );
    }
    const keys = listedGroups.map(groupKey);

    return (
      <Accordion
        type="multiple"
        className="measurementGroups"
        value={keys.filter(key => !collapsedGroups.includes(key))}
        onValueChange={open => setCollapsedGroups(previous => [
          ...previous.filter(key => !keys.includes(key)),
          ...keys.filter(key => !open.includes(key)),
        ])}
      >
        {listedGroups.map((measureGroup, idx) => (
          <AccordionItem key={groupKey(measureGroup, idx)} value={groupKey(measureGroup, idx)} className="measurementGroup">
            <AccordionTrigger asChild>
              <button type="button" className="tableListHeader measurementGroupHeader">
                {getCustomHeader(measureGroup)}
                <span className="measurementGroupToggle" aria-hidden="true">
                  <Icons.Minus className="measurementGroupCollapse" />
                  <Icons.Plus className="measurementGroupExpand" />
                </span>
              </button>
            </AccordionTrigger>
            <AccordionContent>
              {groupBySeries
                ? getSeriesGroups(measureGroup, idx)
                : <TableList headless>{getMeasurements(measureGroup)}</TableList>}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  const getDisplaySettings = () => (
    // The display settings drawer, as the Segmentations panel's (ui-next SegmentationTableConfig)
    <div className="bg-muted mb-0.5 space-y-2 rounded-b px-1.5 pt-0.5 pb-3 annotationsSettings" data-cy="annotations-settings">
      <div className="my-2 flex items-center pl-0.5">
        <Switch id="annotations-group-by-series" checked={groupBySeries} onCheckedChange={setGroupBySeries} />
        <Label htmlFor="annotations-group-by-series" className="text-muted-foreground ml-2.5 mr-2 text-xs">
          {t('Group by series')}
        </Label>
      </div>
      <div className="my-2 flex items-center pl-0.5">
        <Switch id="annotations-search-in-views" checked={applySearchToViews} onCheckedChange={setApplySearchToViews} />
        <Label htmlFor="annotations-search-in-views" className="text-muted-foreground ml-2.5 mr-2 text-xs">
          {t('Filter annotations in imaging viewports')}
        </Label>
      </div>
    </div>
  );

  const getTimepointsHeader = () => {
    return timepoints.map((timepoint, index) => {
      return (
        <div key={index} className="measurementTableHeaderItem">
          <div className="timepointLabel">{t(timepoint.label)}</div>
          <div className="timepointDate">{timepoint.date}</div>
        </div>
      );
    });
  };

  const getWarningContent = () => {
    const { warningList = '' } = overallWarnings;

    if (Array.isArray(warningList)) {
      const listedWarnings = warningList.map((warn, index) => {
        return <li key={index}>{warn}</li>;
      });

      return <ol>{listedWarnings}</ol>;
    }

    return <>{warningList}</>;
  };  

  // Check to see if there are warnings which should be rendered.
  const hasOverallWarnings = overallWarnings.warningList.length > 0;

  return (
    <div className="measurementTable">
      <div className="measurementTableHeader">
        {hasOverallWarnings && (
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip placement="left" className="in tooltip-warning" id="tooltip-left">
                <div className="warningTitle">{t('Criteria nonconformities')}</div>
                <div className="warningContent">{getWarningContent()}</div>
              </Tooltip>
            }
          >
            <span className="warning-status">
              <span className="warning-border">
                <Icon name="exclamation-triangle" />
              </span>
            </span>
          </OverlayTrigger>
        )}
        {getTimepointsHeader()}
      </div>
      {/* The measurement groups (Measurements, Findings, pending) under one collapsible
          section, the same element the Segmentations panel groups its controls with, with the
          groups scrolling inside it: room for the other annotation kinds the panel is to hold */}
      <div className="measurementTableAnnotations">
        <PanelSection defaultOpen>
          <PanelSection.Header className="flex items-center justify-between">
            <span>{t('Annotations')}</span>
            <span
              role="button"
              tabIndex={0}
              className="annotationsSettingsToggle ml-auto mr-2"
              aria-label={t('Display Settings')}
              aria-expanded={showSettings}
              data-cy="annotations-settings-toggle"
              onClick={(event) => {
                event.stopPropagation();
                setShowSettings(open => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  setShowSettings(open => !open);
                }
              }}
            >
              <Icons.Settings className="text-primary h-4 w-4" />
            </span>
          </PanelSection.Header>
          <PanelSection.Content>
            {showSettings && getDisplaySettings()}
            <AnnotationsVisibilityRow
              measurementCollection={listedGroups}
              onQueryChange={setQuery}
              query={query}
              searching={searching}
              onToggleAllVisibility={(visible) => {
                if (searching) {
                  // The matching annotations only
                  rowsOf(listedGroups).forEach(row => measurementApi.toggleVisibilityMeasurement(row.measurementId, visible));
                } else {
                  measurementApi.setAllMeasurementsVisibility(visible);
                }
                measurements.refreshCornerstoneViewports();
              }}
            />
            <ScrollArea className="measurementTableScroll">
              <div>{getMeasurementsGroups()}</div>
            </ScrollArea>
          </PanelSection.Content>
        </PanelSection>
      </div>
      <div className="measurementTableFooter">
        {_.get(server, 'perms.upload', false) && saveFunction && savePending && (
          <button onClick={handleSave} className="saveBtn" data-cy="save-measurements-btn">
            <Icon name="save" width="14px" height="14px" />
            Save measurements
          </button>
        )}
      </div>
    </div>
  );
};


MeasurementTable.propTypes = {
  server: PropTypes.object.isRequired,
  measurementCollection: PropTypes.array.isRequired,
  servicesManager: PropTypes.object.isRequired,
  timepoints: PropTypes.array.isRequired,
  overallWarnings: PropTypes.object.isRequired,
  viewports: PropTypes.object,
  onItemClick: PropTypes.func,
  onRelabelClick: PropTypes.func,
  onDeleteClick: PropTypes.func,
  onEditDescriptionClick: PropTypes.func,
  onOpenInMprClick: PropTypes.func,
  /** Lock or unlock a pending measurement: (event, measurementData) */
  onToggleLockClick: PropTypes.func,
  /** Choose the line or text color of a pending measurement: (event, measurementData, 'line' | 'text') */
  onLineTextColorClick: PropTypes.func,
  saveFunction: PropTypes.func,
  onSaveComplete: PropTypes.func,
  eventTimeout: PropTypes.number,
  /** Whether the side panel holding the table is open; it stays mounted while closed */
  isOpen: PropTypes.bool,  
};




export default MeasurementTable;
