// Viewer "More" menu control for the local/offline study cache (ohif-viewers#125, FR-9).
//
// Renders as "Go offline" (offline-cache icon) when the open study is not cached, or "Remove offline"
// (trash icon) when it is — matching the study-list Action-menu labels (AR-6). It branches the label,
// icon, and dispatched command on live cache/download state by subscribing to LocalCacheService and
// DownloadManagerService events, following the CustomComponent pattern of SeriesTagToolbarButton.js.

import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux, LocalCacheService, DownloadManagerService } from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';


function _activeStudyUID(viewportSpecificData, activeViewportIndex) {
  const vsd = (viewportSpecificData && viewportSpecificData[activeViewportIndex]) || {};
  return vsd.StudyInstanceUID;
}


function LocalCacheToolbarButton({ toolbarClickCallback, button, isActive }) {
  const { id } = button;
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);

  const StudyInstanceUID = _activeStudyUID(viewportSpecificData, activeViewportIndex);

  // Derive the current cache/download state for the active study.
  const computeState = useCallback(() => {
    return {
      cached: LocalCacheService.isStudyCachedSync(StudyInstanceUID),
      downloading: DownloadManagerService.isStudyDownloading(StudyInstanceUID),
    };
  }, [StudyInstanceUID]);

  const [state, setState] = useState(computeState);

  useEffect(() => {
    // Re-evaluate on study change and whenever cache/download state changes.
    setState(computeState());

    const refresh = () => setState(computeState());

    const subs = [
      LocalCacheService.subscribe(LocalCacheService.EVENTS.STUDY_CACHE_UPDATED, refresh),
      DownloadManagerService.subscribe(DownloadManagerService.EVENTS.JOB_STATE_CHANGED, refresh),
      DownloadManagerService.subscribe(DownloadManagerService.EVENTS.JOB_QUEUED, refresh),
    ];

    return () => subs.forEach(s => s.unsubscribe());
  }, [computeState]);

  if (!StudyInstanceUID) {
    return null;
  }

  const { cached, downloading } = state;

  const label = cached ? 'Remove Offline Copy' : downloading ? 'Downloading…' : 'Save Offline Copy';
  const icon = cached ? 'trash' : 'offline-cache';
  // "Go offline" while a download is in flight cancels it; otherwise queue/remove per cache state.
  const commandName = cached ? 'removeOffline' : downloading ? 'cancelStudyDownload' : 'goOffline';

  return (
    <ToolbarButton
      key={id}
      id={id}
      label={label}
      icon={icon}
      onClick={evt => toolbarClickCallback({ ...button, commandName }, evt)}
      isActive={isActive}
    />
  );
}


LocalCacheToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
  isActive: PropTypes.bool,
};


export default LocalCacheToolbarButton;
export { LocalCacheToolbarButton };
