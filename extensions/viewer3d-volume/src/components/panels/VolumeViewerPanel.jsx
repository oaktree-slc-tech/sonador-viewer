import _ from 'lodash';

import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import {
  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

import {
  syncTableSegRepData, checkSegmentsLength, c3dSeg2SegmentationTableData,
  createSyncStyleAttrsCommand, createViewerOnToggleSegmentVisibility, attachCoreSegmentationTableEvents,
} from '../../utils/cornerstone3dSegmentations';

import OHIF from '@ohif/core';
import { CustomSelect, } from '@ohif/ui';
import {
  Button,
  Icons,
  TooltipProvider,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Tooltip, TooltipTrigger, TooltipContent,
  SegmentationTable, useSegmentationExpanded, useSegmentationTableContext,
} from '@ohif/ui-next';
import {
  components as csextComponents
} from '@ohif/extension-cornerstone';

const { DisplaySetApi } = OHIF.display;
const { SonadorSegmentationHeader } = csextComponents

import styles from '@ohif/extension-cornerstone/src/components/SonadorSegmentationPanelTheme.module.scss';



export default function  SonadorVolumeViewerPanel({
    displaySetInstanceUID, commandsManager, servicesManager, eventTimeout = 50,
  }) {
  // React component providing controls for interacting with the Sonador 3D Viewer Panel

  const { t } = useTranslation('SonadorVolumeViewerPanel');
  const { segmentationService } = servicesManager.services;

  // Component Containers: grounds styling
  const [portalContainer, setPortalContainer] = useState(null);

  // Components visible
  const [segmentationsVisible, setSegmentationsVisible] = useState(null);
  const segmentationsVisibleRef = useRef(segmentationsVisible);

  const [activeSegmentationId, setActiveSegmentationId] = useState();
  const segmentationIdRef = useRef(activeSegmentationId);
  const [viewerSegmentations, setViewerSegmentations] = useState([]);
  const viewerSegmentationsRef = useRef(viewerSegmentations);


  function _checkActiveSeg(seg) {
    // Verify that the provied segmentation matches the editor's currently active segmentation

    if (viewerSegmentationsRef.current && viewerSegmentationsRef.current.length > 0) {
      const _seg = viewerSegmentationsRef.current[0];
      return seg?.segmentation?.segmentationId && seg?.segmentation?.segmentationId == segmentationIdRef.current;
    }

    return false;
  }


  // Toggle segment visibility
  const viewerOnToggleSegmentVisibility = createViewerOnToggleSegmentVisibility({
    displaySetInstanceUID, setSegmentations: setViewerSegmentations, segmentationsRef: viewerSegmentationsRef
  }, { segmentationType:  SegmentationRepresentations.Surface, });


  function viewerOnSegmentClick(segmentationId, segIdx) {
    // Toggle the active state of the selected segment
    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);

    // Set active property of segmentation and segment
    if (_checkActiveSeg(viewerSegmentationsRef.current?.length ? viewerSegmentationsRef.current[0] : undefined)) {
      segmentationService.setActiveSegment(segmentationId, segIdx);
    }
  }


  useEffect(() => {

    // Attach segmentations events
    const { displaysets_dataupdate, segservice_segdata_modified } = attachCoreSegmentationTableEvents({
      setSegmentations: setViewerSegmentations, segmentationsRef: viewerSegmentationsRef,
      segmentationIdRef, setActiveSegmentationId, setSegmentationsVisible, segmentationsVisibleRef,
      segmentationService,
    });

    // First-load: Set active segmentationId from displaySet if already loaded
    const _ds0 = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (_ds0 && !_.isNil(_ds0.segmentationSurfaceEnabled)) {
      setSegmentationsVisible(_ds0.segmentationSurfaceEnabled);
      segmentationsVisibleRef.current = _ds0.segmentationSurfaceEnabled;
    }

    if (_ds0?.segmentationId && _ds0.segmentationId != segmentationIdRef.current) {
      setActiveSegmentationId(_ds0.segmentationId);
      setTimeout(() => {
        const _seg = c3dSegmentations.state.getSegmentation(_ds0.segmentationId);
        if (_seg) {
          setViewerSegmentations([c3dSeg2SegmentationTableData(_seg)]);
        }
      }, eventTimeout);
    }

    return () => {

      // Clear OHIF service subscriptions (all handles expose .unsubscribe())
      displaysets_dataupdate?.unsubscribe();
      segservice_segdata_modified?.unsubscribe();
    }
  }, []);


  useEffect(() => {
    // Update the active segmentationId and populate viewerSegmentations array

    // Set ID of currently active segmentation
    segmentationIdRef.current = activeSegmentationId;

    // Retreive and populate viewer segmentations hash
    if (segmentationIdRef && segmentationsVisible) {
      const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      if (_ds.segmentationId && _ds.segmentationId == segmentationIdRef.current) {

        const _seg = c3dSegmentations.state.getSegmentation(_ds.segmentationId);
        if (_seg) {
          setViewerSegmentations([c3dSeg2SegmentationTableData(_seg)]);
        } else { setViewerSegmentations([]); }
      }
    }
  }, [activeSegmentationId, segmentationsVisible]);


  useEffect(() => {
    // Cache a copy of the viewer segmentations

    viewerSegmentationsRef.current = viewerSegmentations;
    console.log('[SonadorVolumeViewerPanel:evt:segmentations-updated]', viewerSegmentations);

  }, [viewerSegmentations])


  return (
    <section className={styles.theme} ref={setPortalContainer}>
    <div className={styles.panelWrapper}>

      <TooltipProvider>
      {segmentationsVisible && (
        <SegmentationTable title='Segmentations' mode='expanded' portalContainer={portalContainer}
            data={viewerSegmentations} disableEditing={true}
            onSegmentClick={viewerOnSegmentClick} onToggleSegmentVisibility={viewerOnToggleSegmentVisibility}>

          <SegmentationTable.Expanded>

            <div className={styles.panelHeader}>
              <SonadorSegmentationHeader portalContainer={portalContainer} />
            </div>

            <div className={styles.panelExpandedContainer}>

            <SegmentationTable.Expanded.Content>

              <div className={styles.panelSegments}>
                <SegmentationTable.Segments>
                  <SegmentationTable.SegmentStatistics.Body />
                </SegmentationTable.Segments>
              </div>
            </SegmentationTable.Expanded.Content>
            </div>

          </SegmentationTable.Expanded>
        </SegmentationTable>
      )}
      </TooltipProvider>

    </div>
    </section>
  );
}
