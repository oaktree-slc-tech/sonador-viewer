import React, { Fragment, memo } from 'react';
import classNames from 'classnames';
import cornerstone from 'cornerstone-core';
import PropTypes from 'prop-types';

import { useViewerMetadataSettingsStore } from '@ohif/sonador-viewer/src/store/useViewerMetadataSettingsStore';
import { OverlayTrigger } from '@ohif/ui/src/components/overlayTrigger';
import { Tooltip } from '@ohif/ui/src/components/tooltip';
import { Icon } from '@ohif/ui/src/elements/Icon';

import {
  formatDICOMDate,
  formatDICOMTime,
  formatNumberPrecision,
  formatPN,
  getCompression,
  isValidNumber,
} from '../utils/formatStudy';

import './OHIFCornerstoneViewportOverlay.css';

function OHIFCornerstoneViewportOverlay({
  imageId,
  scale,
  windowWidth,
  windowCenter,
  inconsistencyWarnings,
  SRLabels,
  imageIndex,
  stackSize,
}) {
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = useViewerMetadataSettingsStore();

  if (!imageId) {
    return null;
  }

  const zoomPercentage = formatNumberPrecision(scale * 100, 0);
  const seriesMetadata = cornerstone.metaData.get('generalSeriesModule', imageId) || {};

  const imagePlaneModule = cornerstone.metaData.get('imagePlaneModule', imageId) || {};
  const { rows, columns, sliceThickness, sliceLocation } = imagePlaneModule;
  const { seriesNumber, seriesDescription, modality, seriesInstanceUID, studyInstanceUID } = seriesMetadata;

  const generalStudyModule = cornerstone.metaData.get('generalStudyModule', imageId) || {};
  const { studyDate, studyTime, studyDescription, accessionNumber } = generalStudyModule;

  const patientModule = cornerstone.metaData.get('patientModule', imageId) || {};
  const { patientId, patientName } = patientModule;

  const generalImageModule = cornerstone.metaData.get('generalImageModule', imageId) || {};
  const { instanceNumber } = generalImageModule;

  const cineModule = cornerstone.metaData.get('cineModule', imageId) || {};
  const { frameTime } = cineModule;

  const frameRate = formatNumberPrecision(1000 / frameTime, 1);
  const compression = getCompression(imageId);
  const wwwc = `W: ${windowWidth.toFixed ? windowWidth.toFixed(0) : windowWidth} L: ${
    windowWidth.toFixed ? windowCenter.toFixed(0) : windowCenter
  }`;
  const imageDimensions = `${columns} x ${rows}`;

  const inconsistencyWarningsOn = inconsistencyWarnings && inconsistencyWarnings.length !== 0;
  const getWarningContent = (warningList) => {
    if (Array.isArray(warningList)) {
      const listedWarnings = warningList.map((warn, index) => {
        return <li key={index}>{warn}</li>;
      });

      return <ol>{listedWarnings}</ol>;
    } else {
      return { warningList };
    }
  };

  const getWarningInfo = (seriesNumber, inconsistencyWarnings) => {
    if (inconsistencyWarnings.length === 0) {
      return null;
    }

    return (
      <OverlayTrigger
        key={seriesNumber}
        placement="left"
        overlay={
          <Tooltip placement="left" className="in tooltip-warning" id="tooltip-left">
            <div className="warningTitle">Series Inconsistencies</div>
            <div className="warningContent">{getWarningContent(inconsistencyWarnings)}</div>
          </Tooltip>
        }
      >
        <div className={classNames('warning')}>
          <span className="warning-icon">
            <Icon name="exclamation-triangle" />
          </span>
        </div>
      </OverlayTrigger>
    );
  };

  const SRLabelsOn = SRLabels && SRLabels.length !== 0;

  const getSRLabelsContent = (SRLabels) => {
    if (Array.isArray(SRLabels)) {
      return (
        <ol>
          {SRLabels.map((SRLabel, index) => {
            const color = SRLabel.labels.color;
            return (
              SRLabel.labels.visible && (
                <OverlayTrigger
                  key={index}
                  placement="top"
                  overlay={
                    <Tooltip placement="top" className="in tooltip-warning" id="tooltip-top">
                      <div className="warningTitle"> Coding scheme designators </div>
                      <div className="warningContent">
                        {SRLabel.labels.labelCodingSchemeDesignator +
                          ' : ' +
                          SRLabel.labels.valueCodingSchemeDesignator}
                      </div>
                    </Tooltip>
                  }
                >
                  <div style={{ display: 'inline-block' }}>
                    <button
                      style={{
                        backgroundColor: color,
                      }}
                      disabled
                      key={index}
                      className="disabledButton"
                    >
                      {SRLabel.labels.label + ' : ' + SRLabel.labels.value}
                    </button>
                  </div>
                </OverlayTrigger>
              )
            );
          })}
        </ol>
      );
    } else {
      return null;
    }
  };

  const getSRLabelsInfo = (SRLabels) => {
    return SRLabels.length !== 0 ? getSRLabelsContent(SRLabels) : null;
  };

  const elements = {
    patientName: <div>{formatPN(patientName)}</div>,
    patientId: <div>{patientId}</div>,
    studyDescription: <div>{studyDescription}</div>,
    'studyDate-studyTime': (
      <div>
        {formatDICOMDate(studyDate)} {formatDICOMTime(studyTime)}
      </div>
    ),
    seriesNumber: <div>{seriesNumber >= 0 ? `Ser: ${seriesNumber}` : ''}</div>,
    'Img-instance-number-index-stack-size': (
      <div>{stackSize > 1 ? `Img: ${instanceNumber} ${imageIndex}/${stackSize}` : ''}</div>
    ),
    'frameRate-image-info': (
      <div>
        {frameRate >= 0 ? `${formatNumberPrecision(frameRate, 2)} FPS` : ''}
        <div>{imageDimensions}</div>
        <div>
          {isValidNumber(sliceLocation) ? `Loc: ${formatNumberPrecision(sliceLocation, 2)} mm ` : ''}
          {sliceThickness ? `Thick: ${formatNumberPrecision(sliceThickness, 2)} mm` : ''}
        </div>
        <div>{seriesDescription}</div>
      </div>
    ),
    zoomPercentage: <div>Zoom: {zoomPercentage}%</div>,
    wwwc: <div>{wwwc}</div>,
    compression: <div className="compressionIndicator">{compression}</div>,
    modality: <div>Modality: {modality}</div>,
    seriesInstanceUID: seriesInstanceUID ? <div>Series Instance UID: {seriesInstanceUID}</div> : null,
    studyInstanceUID: studyInstanceUID ? <div>Study Instance UID: {studyInstanceUID}</div> : null,
    accessionNumber: accessionNumber ? <div>Accession Number: {accessionNumber}</div> : null,
  };

  return (
    <div className="OHIFCornerstoneViewportOverlay">
      <div className="top-left overlay-element">
        {topLeftCorner.map(({ value }, index) => {
          return <Fragment key={index}>{elements[value]}</Fragment>;
        })}
      </div>
      <div className="top-right overlay-element">
        {topRightCorner.map(({ value }, index) => {
          return <Fragment key={index}>{elements[value]}</Fragment>;
        })}
      </div>
      <div className="bottom-right overlay-element">
        {bottomRightCorner.map(({ value }, index) => {
          return <Fragment key={index}>{elements[value]}</Fragment>;
        })}
      </div>
      <div className="bottom-left2 warning">
        <div>{inconsistencyWarningsOn ? getWarningInfo(seriesNumber, inconsistencyWarnings) : ''}</div>
      </div>
      <div className="bottom-left3 warning">
        <div>{SRLabelsOn ? getSRLabelsInfo(SRLabels) : ''}</div>
      </div>
      <div className="bottom-left overlay-element">
        {bottomLeftCorner.map(({ value }, index) => {
          return <Fragment key={index}>{elements[value]}</Fragment>;
        })}
      </div>
    </div>
  );
}

OHIFCornerstoneViewportOverlay.propTypes = {
  scale: PropTypes.number.isRequired,
  windowWidth: PropTypes.oneOfType([PropTypes.number.isRequired, PropTypes.string.isRequired]),
  windowCenter: PropTypes.oneOfType([PropTypes.number.isRequired, PropTypes.string.isRequired]),
  imageId: PropTypes.string.isRequired,
  imageIndex: PropTypes.number.isRequired,
  stackSize: PropTypes.number.isRequired,
  inconsistencyWarnings: PropTypes.array,
  SRLabels: PropTypes.array,
};

export default memo(OHIFCornerstoneViewportOverlay);
