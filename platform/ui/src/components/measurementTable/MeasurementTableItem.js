import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { OverlayTrigger } from '../overlayTrigger';
import { TableListItem } from '../tableList';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';

import './MeasurementTableItem.styl';

const ColoredCircle = ({ color }) => {
  return <div className="item-color" style={{ backgroundColor: color }}></div>;
};

ColoredCircle.propTypes = {
  color: PropTypes.string.isRequired,
};

const MeasurementTableItem = ({
  onDelete,
  itemIndex,
  measurementData,
  onRelabel,
  onItemClick,
  onEditDescription,
  itemClass,
}) => {
  const { t } = useTranslation('MeasurementTable');

  const [collapsed, setCollapsed] = useState(true);
  const [visible, setVisible] = useState(true);

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
    event.stopPropagation();
    onDelete(event, measurementData);
  };

  const onRelabelClick = (event) => {
    event.stopPropagation();
    onRelabel(event, measurementData);
  };

  const onEditDescriptionClick = (event) => {
    event.stopPropagation();
    onEditDescription(event, measurementData);
  };

  const handleItemClick = (event) => {
    onItemClick(event, measurementData);
  };

  const getTableListItem = () => {
    const hasWarningClass = measurementData.hasWarnings && !measurementData.isReadOnly ? 'hasWarnings' : '';

    const actionButtons = [];

    if (typeof onRelabel === 'function') {
      const relabelButton = getActionButton('Relabel', onRelabelClick);
      actionButtons.push(relabelButton);
    }
    if (typeof onEditDescription === 'function') {
      const descriptionButton = getActionButton('Description', onEditDescriptionClick);
      actionButtons.push(descriptionButton);
    }
    if (typeof onDelete === 'function') {
      const deleteButton = getActionButton('Delete', onDeleteClick);
      actionButtons.push(deleteButton);
    }

    if (measurementData.isSRText && measurementData.labels && measurementData.labels.length > 0) {
      return (
        <>
          <TableListItem
            key={measurementData.measurementNumber}
            itemKey={measurementData.measurementNumber}
            itemClass={`measurementItem ${itemClass} ${hasWarningClass}`}
            itemIndex={itemIndex}
            onItemClick={handleItemClick}
          >
            <div>
              <div className="measurementLocation">
                {t(measurementData.label, {
                  keySeparator: '>',
                  nsSeparator: '|',
                })}
              </div>
            </div>
            <div className="icons">
              <div className="displayTexts">{getDataDisplayText()}</div>
              <Icon
                className={`eye-icon`}
                name={visible ? 'eye' : 'eye-closed'}
                width="20px"
                height="20px"
                onClick={() => {
                  measurementData.labels.forEach((label) => {
                    label.visible = !visible;
                  });

                  setVisible((prevState) => !prevState);
                }}
              />
              <Icon
                className={`angle-double-${collapsed ? 'down' : 'up'}`}
                name={`angle-double-${collapsed ? 'down' : 'up'}`}
                width="20px"
                height="20px"
                onClick={() => {
                  setCollapsed((prevState) => !prevState);
                }}
              />
            </div>
          </TableListItem>
          {collapsed &&
            measurementData.labels.map((SRLabel, index) => {
              return (
                <TableListItem
                  key={index}
                  itemKey={index}
                  itemMeta={<ColoredCircle color={SRLabel.color} />}
                  itemMetaClass="item-color-section"
                  onItemClick={handleItemClick}
                >
                  <div>
                    <div className="icons">
                      <span style={{ width: '90px' }}>{SRLabel.label + ' : ' + SRLabel.value}</span>
                      <Icon
                        className={`eye-icon`}
                        name={SRLabel.visible ? 'eye' : 'eye-closed'}
                        width="20px"
                        height="20px"
                        onClick={() => {
                          SRLabel.visible = !SRLabel.visible;
                        }}
                      />
                    </div>
                  </div>
                </TableListItem>
              );
            })}
        </>
      );
    } else {
      return (
        <TableListItem
          key={measurementData.measurementNumber}
          itemKey={measurementData.measurementNumber}
          itemClass={`measurementItem ${itemClass} ${hasWarningClass}`}
          itemIndex={itemIndex}
          onItemClick={handleItemClick}
        >
          <div>
            <div className="measurementLocation">
              {t(measurementData.label, {
                keySeparator: '>',
                nsSeparator: '|',
              })}
            </div>
            <div className="displayTexts">{getDataDisplayText()}</div>
            {!measurementData.isReadOnly && <div className="rowActions">{actionButtons}</div>}
          </div>
        </TableListItem>
      );
    }
  };

  const getDataDisplayText = () => {
    return measurementData.data.map((data, index) => {
      return (
        <div key={`displayText_${index}`} className="measurementDisplayText">
          {data.displayText ? data.displayText : '...'}
        </div>
      );
    });
  };

  const getWarningContent = () => {
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

  const { warningTitle = '', hasWarnings, isReadOnly } = measurementData;

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
};

export { MeasurementTableItem };
