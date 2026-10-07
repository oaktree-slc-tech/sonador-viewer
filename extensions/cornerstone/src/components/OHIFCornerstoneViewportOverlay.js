import React, { memo } from 'react';
import classNames from 'classnames';
import cornerstone from 'cornerstone-core';
import PropTypes from 'prop-types';

import { DicomMetadataStore } from '@ohif/core';
import { useDicomHeadersOverlayStore } from '@ohif/sonador-viewer/src/store/useDicomHeadersOverlay';
import { useViewerMetadataSettingsStore } from '@ohif/sonador-viewer/src/store/useViewerMetadataSettingsStore';
import { OverlayTrigger } from '@ohif/ui/src/components/overlayTrigger';
import { Tooltip } from '@ohif/ui/src/components/tooltip';
import { Icon } from '@ohif/ui/src/elements/Icon';

import { buildOverlayContext, resolveOverlayItem } from '../utils/overlayFields/resolvers';

import './OHIFCornerstoneViewportOverlay.css';

function getSeriesInstances(instance) {
  if (!instance) {
    return null;
  }

  const series = DicomMetadataStore.getSeries(instance.StudyInstanceUID, instance.SeriesInstanceUID);
  return series ? series.instances : null;
}

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

  // Toggled by the `toggleOverlay` command (Settings > Hotkeys), not by a listener here.
  const { showOverlay } = useDicomHeadersOverlayStore();

  if (!imageId) {
    return null;
  }

  if(!showOverlay){
    return  null
  }

  const ctx = buildOverlayContext(
    { imageId, scale, windowWidth, windowCenter, imageIndex, stackSize },
    { metaData: cornerstone.metaData, getSeriesInstances }
  );
  const { seriesNumber } = ctx.modules.generalSeriesModule;

  const renderCorner = items =>
    items.map((item, index) => {
      const resolved = resolveOverlayItem(item, ctx);
      if (!resolved) {
        return null;
      }

      return (
        <div key={index} className={resolved.className}>
          {resolved.lines.map((line, lineIndex) => (
            <div key={lineIndex}>{line}</div>
          ))}
        </div>
      );
    });

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

  return (
    <div className="OHIFCornerstoneViewportOverlay">
      <div className="top-left overlay-element">
        {renderCorner(topLeftCorner)}
      </div>
      <div className="top-right overlay-element">
        {renderCorner(topRightCorner)}
      </div>
      <div className="bottom-right overlay-element">
        {renderCorner(bottomRightCorner)}
      </div>
      <div className="bottom-left2 warning">
        <div>{inconsistencyWarningsOn ? getWarningInfo(seriesNumber, inconsistencyWarnings) : ''}</div>
      </div>
      <div className="bottom-left3 warning">
        <div>{SRLabelsOn ? getSRLabelsInfo(SRLabels) : ''}</div>
      </div>
      <div className="bottom-left overlay-element">
        {renderCorner(bottomLeftCorner)}
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

OHIFCornerstoneViewportOverlay.displayName = 'OHIFCornerstoneViewportOverlay';

export default memo(OHIFCornerstoneViewportOverlay);
