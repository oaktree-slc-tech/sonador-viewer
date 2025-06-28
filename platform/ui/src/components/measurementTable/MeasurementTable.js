import _ from 'lodash';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';

import { Icon } from './../../elements/Icon';

import { ScrollableArea } from '../../ScrollableArea/ScrollableArea';
import { OverlayTrigger } from '../overlayTrigger';
import { TableList } from '../tableList';
import { Tooltip } from '../tooltip';

import { MeasurementTableItem } from './MeasurementTableItem';

const { measurements, log } = OHIF;
const { MeasurementApi } = measurements;

import './MeasurementTable.styl';


const MeasurementTable = ({
  server,
  measurementCollection,
  servicesManager,
  viewports,
  overallWarnings,  
  timepoints,
  onItemClick,
  onRelabelClick,
  onDeleteClick,
  onEditDescriptionClick,
  selectedMeasurementId,
  saveFunction,
  onSaveComplete,
  eventTimeout,
}) => {
  // Unpack references to services  
  const { displaySetService } = servicesManager.services;
  
  const { t } = useTranslation();
  const measurementApi = MeasurementApi.Instance;

  // State flags for the measurement collection, selected key, and save pending attributes
  const [activeDisplaySet, setActiveDisplaySet] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [savePending, setSavePending] = useState(false);

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
            type: 'success',
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
        <div className="numberOfItems">{measureGroup.measurements.length}</div>
      </>
    );
  };

  const getMeasurementsGroups = () => {
    // Retrieve measurements by group

    return measurementCollection.map((measureGroup, idx) => {
      return (
        <TableList key={idx} customHeader={getCustomHeader(measureGroup)}>
          {getMeasurements(measureGroup)}
        </TableList>
      );
    });
  };

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
      <ScrollableArea>
        <div>{getMeasurementsGroups()}</div>
      </ScrollableArea>
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
  saveFunction: PropTypes.func,
  onSaveComplete: PropTypes.func,
  eventTimeout: PropTypes.number,  
};


MeasurementTable.defaultProps = {
  overallWarnings: {
    warningList: [],
  },
  eventTimeout: 50,
};


export default MeasurementTable;
