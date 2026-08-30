// Module provides components with a preview and summary of the DICOM data for a series.
import _ from 'lodash';
import throttle from 'lodash.throttle';

import React, { useEffect, useState } from 'react';
import { useDrag } from 'react-dnd';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

import PropTypes from 'prop-types';

import OHIF, { classes } from '@ohif/core';

import { OverlayTrigger } from '../overlayTrigger';
import { Tooltip } from '../tooltip';

import { Icon } from './../../elements/Icon';
import ImageThumbnail from './ImageThumbnail';

import './Thumbnail.styl';

const StudyLoadingListener = classes.StudyLoadingListener;
const { LocalCacheService } = OHIF;
const formatBytes = OHIF.utils.formatBytes;


function SeriesCacheBadge({ StudyInstanceUID, SeriesInstanceUID }) {
  // Offline-availability indicator for a series thumbnail (ohif-viewers#125, FR-8). Shows an
  // offline-cache icon when the series is locally cached; the hover popup (OverlayTrigger + Tooltip,
  // reusing the getWarningInfo pattern per AR-9) reports cached-instance count + storage size.
  //
  // A pure indicator, with no control of its own (ohif-viewers#130, FR-7): removing the local copy
  // is "Remove Offline Storage" in this thumbnail's own series actions menu, and two removal
  // affordances on one thumbnail would be worse than one.
  const { t } = useTranslation('Common');
  const compute = () =>
    LocalCacheService
      ? {
          cached: LocalCacheService.isSeriesCachedSync(SeriesInstanceUID),
          summary: LocalCacheService.getSeriesSummary(StudyInstanceUID, SeriesInstanceUID),
        }
      : { cached: false, summary: null };

  const [state, setState] = useState(compute);

  useEffect(() => {
    if (!LocalCacheService) {
      return undefined;
    }
    setState(compute());
    const refresh = () => setState(compute());
    const sub = LocalCacheService.subscribe(LocalCacheService.EVENTS.STUDY_CACHE_UPDATED, refresh);
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [StudyInstanceUID, SeriesInstanceUID]);

  if (!state.cached || !SeriesInstanceUID) {
    return null;
  }

  const { summary } = state;
  const instanceCount = summary?.instanceCount ?? 0;
  const totalBytes = summary?.totalBytes ?? 0;

  return (
    <OverlayTrigger
      key={`cache-${SeriesInstanceUID}`}
      placement="left"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip placement="left" className="in tooltip-cache" id={`tooltip-cache-${SeriesInstanceUID}`}>
          <div className="warningTitle">{t('Available offline')}</div>
          <div className="warningContent">
            <div>
              {instanceCount} {instanceCount === 1 ? t('instance cached') : t('instances cached')}
            </div>
            <div>{formatBytes(totalBytes)}</div>
          </div>
        </Tooltip>
      }
    >
      <div className="cache-indicator">
        <span className="cache-icon">
          <Icon name="offline-cache" />
        </span>
      </div>
    </OverlayTrigger>
  );
}


function ThumbnailFooter({ SeriesDescription, SeriesNumber, numImageFrames, hasWarnings, hasDerivedDisplaySets, hasClientWarnings, StudyInstanceUID, SeriesInstanceUID, seriesActions }) {
  // Footer which summarizes the attributes of an imaging series including description, series number, 
  // warnings, and other information to be summarized for the user.

  const [inconsistencyWarnings, inconsistencyWarningsSet] = useState([]);
  const [derivedDisplaySetsActive, derivedDisplaySetsActiveSet] = useState([]);
  const [clientWarnings, setClientWarnings] = useState([]);

  useEffect(() => {
    // Update warning lists from background promises
    let unmounted = false;

    // Series inconsistency warnings (set during init by SOP Class Handlers)
    hasWarnings.then((response) => {
      if (!unmounted) {
        inconsistencyWarningsSet(response);
      }
    });

    // Derived displaySet warnings (created by SOP Class Handlers about reference series)
    hasDerivedDisplaySets.then((response) => {
      if (!unmounted) {
        derivedDisplaySetsActiveSet(response);
      }
    });

    // Client warnings: created by OHIF display components
    if (hasClientWarnings) {
      setClientWarnings(hasClientWarnings);
    }

    return () => { unmounted = true; };
  }, [hasWarnings, hasDerivedDisplaySets, hasClientWarnings]);

  const infoOnly = !SeriesDescription;

  const getInfo = (value, icon, className = '') => {
    return (
      <div className={classNames('item item-series', className)}>
        <div className="icon">{icon}</div>
        <div className="value">{value}</div>
      </div>
    );
  };

  const getWarningContent = (inconsistencyWarnings, clientWarnings) => {
    // Retrieve content for inconsistency and client warnings.
    inconsistencyWarnings = inconsistencyWarnings || [];
    clientWarnings = clientWarnings || [];    

    if (inconsistencyWarnings || clientWarnings) {

      // Series inconsistency warnings
      const _inconsistency = inconsistencyWarnings.map((warn, index) => {
        return <li key={index}>{warn}</li>
      });

      // Combined warnings list
      const listedWarnings = [
        ..._inconsistency, 
        ...clientWarnings.map((warn, index) => {
          return <li key={_inconsistency.length+index}>{warn}</li>
        }),
      ];

      return <ol>{listedWarnings}</ol>;
    }

    return <>{inconsistencyWarnings}</>;
  };

  const getWarningInfo = (SeriesNumber, inconsistencyWarnings, clientWarnings) => {
    if (!inconsistencyWarnings?.length && !clientWarnings?.length) {
      return null;
    }

    return (
      <OverlayTrigger
        key={SeriesNumber}
        placement="left"
        overlay={
          <Tooltip placement="left" className="in tooltip-warning" id="tooltip-left">
            <div className="warningTitle">Series Warnings</div>
            <div className="warningContent">{getWarningContent(inconsistencyWarnings, clientWarnings)}</div>
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

  const getDerivedInfo = (derivedDisplaySetsActive) => {
    // Only when there IS a derived resource (a DICOM-SEG or DICOM-SR referencing this series).
    // The guard used to be `!derivedDisplaySetsActive`, and the state initialises to `[]` -- a
    // truthy empty array -- so the link icon rendered on every thumbnail regardless. Handles both
    // shapes because the resolved value has been a list in some paths and a flag in others.
    const hasDerived = Array.isArray(derivedDisplaySetsActive)
      ? derivedDisplaySetsActive.length > 0
      : !!derivedDisplaySetsActive;

    if (!hasDerived) {
      return null;
    }

    return (
      <div className="derived">
        <Icon name="link" />
      </div>
    );
  };

  const getSeriesInformation = (SeriesNumber, numImageFrames, inconsistencyWarnings, derivedDisplaySetsActive, clientWarnings) => {
    // The actions menu alone is reason enough to render this row: a series with no number and no
    // frame count still has a series to download or remove.
    if (!SeriesNumber && !numImageFrames && !seriesActions) {
      return null;
    }

    // Two explicit groups rather than six loose children under `justify-content: space-between`,
    // which spread every indicator evenly across the row and left nothing anchored to either edge.
    // Left is what the series IS (number, instance count); right is its state and its controls,
    // ordered so the actions button is always the outermost thing and the indicators sit inboard
    // of it in a stable order.
    return (
      <div className="series-information">
        <div className="series-information-left">
          {SeriesNumber !== undefined && getInfo(SeriesNumber, 'S:')}
          {numImageFrames !== undefined && getInfo(numImageFrames, '', 'image-frames')}
        </div>
        <div className="series-information-right">
          <SeriesCacheBadge StudyInstanceUID={StudyInstanceUID} SeriesInstanceUID={SeriesInstanceUID} />
          {getWarningInfo(SeriesNumber, inconsistencyWarnings, clientWarnings)}
          {getDerivedInfo(derivedDisplaySetsActive)}
          {seriesActions}
        </div>
      </div>
    );
  };

  return (
    <div className={classNames('series-details', { 'info-only': infoOnly })}>
      <div className="series-description">{SeriesDescription}</div>
      {getSeriesInformation(SeriesNumber, numImageFrames, inconsistencyWarnings, derivedDisplaySetsActive, clientWarnings)}
    </div>
  );
}


const noop = () => {};


function Thumbnail({
  supportsDrag = false,
  active = false,
  error = false,
  onDoubleClick = noop,
  onClick = noop,
  onMouseDown = noop,
  altImageText,
  displaySetInstanceUID,
  imageId,
  imageSrc,
  StudyInstanceUID,
  showProgressBar,
  seriesActions,
  ...props
}) {
  // Summary of the medical imaging displayed to the user in the viewer sidepanel.


  // Component state
  const [stackPercentComplete, setStackPercentComplete] = useState(props.stackPercentComplete || 0);
  const [clientWarnings, setClientWarnings] = useState([]);
  
  // Update state properties from displaySet
  const displaySetApi = OHIF.display.DisplaySetApi.Instance;
  useEffect(() => {
    // Subscribe to display set events
    const displayset_update = displaySetApi.displaySetService.subscribe(
      displaySetApi.displaySetService.EVENTS.DISPLAY_SET_CHANGED, ({ displaySetInstanceUID: _dsUid, displaySet: _ds }) => {

        // Update series warnings and notifications from displayset including distortion filter
        // and other service side checks. 
        if (_dsUid == displaySetInstanceUID) {
          if (_ds.clientWarnings) {
            setClientWarnings(_ds.clientWarnings);
          }
        }
      });

    return () => {

      // Clear service subscriptions
      displayset_update.unsubscribe();
    }
  }, [])

  // Loading indicator
  useEffect(() => {
    // Update the progress bar to reflect the status of the series as it loads

    const onProgressChange = throttle(({ detail }) => {
      const { progressId, progressData } = detail;
      if (`StackProgress:${displaySetInstanceUID}` === progressId) {
        const percent = progressData ? progressData.percentComplete : 0;
        if (percent > stackPercentComplete) {
          setStackPercentComplete(percent);
        }
      }
    }, 100);

    document.addEventListener(StudyLoadingListener.events.OnProgress, onProgressChange);

    return () => {
      document.removeEventListener(StudyLoadingListener.events.OnProgress, onProgressChange);
    };
  }, [displaySetInstanceUID, stackPercentComplete]);

  const [, drag] = useDrag(() => ({
    // `droppedItem` in `dropTarget`
    // The only data it will have access to
    type: 'thumbnail', // Has to match `dropTarget`'s type
    item: {
      StudyInstanceUID,
      displaySetInstanceUID,
    },
    canDrag: function () {
      return supportsDrag;
    },
  }));

  const hasImage = imageSrc || imageId;
  const hasAltText = altImageText !== undefined;

  return (
    <div
      ref={drag}
      className={classNames('thumbnail', { active: active })}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
    >
      {/* SHOW IMAGE */}
      {hasImage && (        
        <ImageThumbnail
          active={active}
          imageSrc={imageSrc}
          imageId={imageId}
          error={error}
          stackPercentComplete={stackPercentComplete}
          showProgressBar={showProgressBar}
        />
      )}
      {/* SHOW TEXT ALTERNATIVE */}
      {!hasImage && hasAltText && (
        <div className="alt-image-text p-x-1">
          <h1>{altImageText}</h1>
        </div>
      )}
      {ThumbnailFooter({ ...props, StudyInstanceUID, seriesActions, hasClientWarnings: clientWarnings })}
    </div>
  );
}


Thumbnail.propTypes = {
  supportsDrag: PropTypes.bool,
  id: PropTypes.string.isRequired,
  displaySetInstanceUID: PropTypes.string.isRequired,
  StudyInstanceUID: PropTypes.string.isRequired,
  imageSrc: PropTypes.string,
  imageId: PropTypes.string,
  error: PropTypes.bool,
  active: PropTypes.bool,
  stackPercentComplete: PropTypes.number,
  /**
   altImageText will be used when no imageId or imageSrc is provided.
   It will be displayed inside the <div>. This is useful when it is difficult
   to make a preview for a type of DICOM series (e.g. DICOM-SR)
   */
  altImageText: PropTypes.string,
  SeriesDescription: PropTypes.string,
  SeriesNumber: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  hasWarnings: PropTypes.instanceOf(Promise),
  hasDerivedDisplaySets: PropTypes.instanceOf(Promise),
  numImageFrames: PropTypes.number,
  onDoubleClick: PropTypes.func,
  onClick: PropTypes.func,
  onMouseDown: PropTypes.func,
  showProgressBar: PropTypes.bool,
  /**
   Optional node rendered at the far right of the footer's series-information row. The viewer's
   study browser supplies a series actions menu here; every other consumer of this component
   passes nothing and gets no menu.
   */
  seriesActions: PropTypes.node,
};


export { Thumbnail };
