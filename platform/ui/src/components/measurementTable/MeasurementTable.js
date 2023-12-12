import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { ScrollableArea } from '../../ScrollableArea/ScrollableArea';
import { OverlayTrigger } from '../overlayTrigger';
import { TableList } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';
import { MeasurementTableItem } from './MeasurementTableItem';

import './MeasurementTable.styl';

const MeasurementTable = ({
  overallWarnings,
  readOnly = false,
  measurementCollection,
  timepoints,
  onItemClick,
  onRelabelClick,
  onDeleteClick,
  onEditDescriptionClick,
  selectedMeasurementNumber,
  saveFunction,
  onSaveComplete,
}) => {
  const { t } = useTranslation();

  const [selectedKey, setSelectedKey] = useState(null);

  const handleItemClick = (event, measurementData) => {
    if (readOnly) return;

    setSelectedKey(measurementData.measurementNumber);

    if (onItemClick) {
      onItemClick(event, measurementData);
    }
  };

  const handleSave = async () => {
    if (saveFunction) {
      try {
        const result = await saveFunction();
        if (onSaveComplete) {
          onSaveComplete({
            title: 'STOW SR',
            message: result.message,
            type: 'success',
          });
        }
      } catch (error) {
        if (onSaveComplete) {
          onSaveComplete({
            title: 'STOW SR',
            message: error.message,
            type: 'error',
          });
        }
      }
    }
  };

  const getMeasurements = (measureGroup) => {
    const selectedKeyValue = selectedMeasurementNumber ? selectedMeasurementNumber : selectedKey;

    return measureGroup.measurements.map((measurement, index) => {
      const key = measurement.measurementNumber;
      const itemIndex = measurement.itemNumber || index + 1;
      const itemClass = selectedKeyValue === key && !readOnly ? 'selected' : '';

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
    return measurementCollection.map((measureGroup, index) => {
      return (
        <TableList key={index} customHeader={getCustomHeader(measureGroup)}>
          {getMeasurements(measureGroup)}
        </TableList>
      );
    });
  };

  const getTimepointsHeader = () => {
    return timepoints.map((timepoint, index) => {
      return (
        <div key={index} className="measurementTableHeaderItem">
          <div className="timepointLabel">{t(timepoint.key)}</div>
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
        {saveFunction && (
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
  measurementCollection: PropTypes.array.isRequired,
  timepoints: PropTypes.array.isRequired,
  overallWarnings: PropTypes.object.isRequired,
  readOnly: PropTypes.bool,
  onItemClick: PropTypes.func,
  onRelabelClick: PropTypes.func,
  onDeleteClick: PropTypes.func,
  onEditDescriptionClick: PropTypes.func,
  selectedMeasurementNumber: PropTypes.number,
  saveFunction: PropTypes.func,
  onSaveComplete: PropTypes.func,
};

MeasurementTable.defaultProps = {
  overallWarnings: {
    warningList: [],
  },
};

export default MeasurementTable;
