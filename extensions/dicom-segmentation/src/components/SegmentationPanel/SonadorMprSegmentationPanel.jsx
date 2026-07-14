import _ from 'lodash';

import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import {
  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

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

import {
  cornerstone3dSegmentationUtils as c3dSegUtils
} from '@ohif/extension-viewer3d-volume';

import { Enums as vtkEnums } from '@ohif/extension-vtk';

const { DisplaySetApi } = OHIF.display;
const { SonadorSegmentationHeader } = csextComponents

import styles from '@ohif/extension-cornerstone/src/components/SonadorSegmentationPanelTheme.module.scss';


export default function SonadorMprSegmentationPanel({
    displaySetInstanceUID, commandsManager, servicesManager, eventTimeout = 50
  }) {
  // React component providing controls for interacting with the Sonador MPR Viewer Panel

  const { t } = useTranslation('SonadorMprSegmentationPanel');
  
  const { segmentationService } = servicesManager.services;
  
  // Component Containers: grounds styling for the editor
  const [portalContainer, setPortalContainer] = useState(null);

  // Active segmentation ID
  const [activeSegmentationId, setActiveSegmentationId] = useState();
  const segmentationIdRef = useRef(activeSegmentationId);
  const [mprSegmentations, setMprSegmentations] = useState([]);
  const mprSegmentationsRef = useRef(mprSegmentations);

  // Cache labelmap style defaults at mount time so they can be restored when the panel closes
  const labelmapStyleDefaultsRef = useRef(c3dSegmentations.config.style.getStyle({ type: SegmentationRepresentations.Labelmap }));


  useEffect(() => {
    // Configure core subscriptions and event handlers

    // displaySet API: displaySet changed
    const { displaysets_dataupdate, segservice_segdata_modified } = c3dSegUtils.attachCoreSegmentationTableEvents({
      segmentationService,
      setSegmentations: setMprSegmentations, segmentationsRef: mprSegmentationsRef, setActiveSegmentationId, segmentationIdRef,
    }, {
      logPrefix: 'SonadorMprSegmentationPanel',
      onAddSegment: ({ segmentationId, }) => {
        // Update style display attributes

        const _style = c3dSegmentations.config.style.getStyle({ segmentationId, type: SegmentationRepresentations.Labelmap, });
        syncStyleAttrs(_style, { force: true });
      },
    });

    return () => {

      // Clear OHIF service subscriptions
      displaysets_dataupdate.unsubscribe();
      segservice_segdata_modified?.unsubscribe();

      // Restore labelmap style defaults when the panel closes, mirroring the pattern used in
      // OHIFSegmentationEditorViewport.componentWillUnmount. A short timeout ensures viewport
      // teardown has settled before the style reset is applied.
      const _segmentationId = segmentationIdRef.current;
      if (_segmentationId) {
        setTimeout(() => {
          const defaults = labelmapStyleDefaultsRef.current;
          commandsManager.runCommand('setFillAlpha', { value: defaults.fillAlpha, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
          commandsManager.runCommand('setOutlineWidth', { value: defaults.outlineWidth, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
          commandsManager.runCommand('setRenderFill', { value: defaults.renderFill, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
          commandsManager.runCommand('setRenderFillInactive', { value: defaults.renderFillInactive, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
          commandsManager.runCommand('setRenderOutline', { value: defaults.renderOutline, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
          commandsManager.runCommand('setRenderOutlineInactive', { value: defaults.renderOutlineInactive, segmentationId: _segmentationId }, vtkEnums.VIEWPORT);
        }, eventTimeout);
      }
    }

  }, [])

  
  // Active segmentation display
  const labelmapStyleDefaults = c3dSegmentations.config.style.getStyle({ type: SegmentationRepresentations.Labelmap });
  
  const [renderFill, setRenderFillState] = useState(labelmapStyleDefaults.renderFill);
  const renderFillRef = useRef(renderFill);
  const [renderFillInactive, setRenderFillInactiveState] = useState(labelmapStyleDefaults.renderFillInactive);
  const renderFillInactiveRef = useRef(renderFillInactive);
  const [renderOutline, setRenderOutlineState] = useState(labelmapStyleDefaults.renderOutline);
  const renderOutlineRef = useRef(renderOutline);
  const [renderOutlineInactive, setRenderOutlineInactiveState] = useState(labelmapStyleDefaults.renderOutlineInactive);
  const renderOutlineInactiveRef = useRef(renderOutlineInactive);
  
  const [outlineWidth, setRenderOutlineWidthState] = useState(labelmapStyleDefaults.outlineWidth);
  const outlineWidthRef = useRef(outlineWidth);
  
  const [fillAlpha, setFillAlphaState] = useState(labelmapStyleDefaults.fillAlpha);
  const fillAlphaRef = useRef(fillAlpha);

  
  function _checkActiveSeg(seg) {
    // Verify that the provied segmentation matches the editor's currently active segmentation
    
    return c3dSegUtils.checkActiveSeg(seg, mprSegmentationsRef, segmentationIdRef);    
  }

  
  // Synchronize the provided style definition with the configuration attributes in the segmentation table
  const syncStyleAttrs = c3dSegUtils.createSyncStyleAttrsCommand({
    setRenderFillState, renderFillRef, setRenderFillInactiveState, renderFillInactiveRef,
    setRenderOutlineState, renderOutlineRef, setRenderOutlineInactiveState, renderOutlineInactiveRef,
    setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef
  });


  // Toggle segment and segmentation representation visibility
  const mprOnToggleSegmentVisibility = c3dSegUtils.createViewerOnToggleSegmentVisibility({
    displaySetInstanceUID, setSegmentations: setMprSegmentations, segmentationsRef: mprSegmentationsRef,
  });

  const mprOnToggleSegmentationRepresentationVisibility = c3dSegUtils.createViewerOnToggleSegmentationRepresentationVisibility({
    setSegmentations: setMprSegmentations, segmentationsRef: mprSegmentationsRef, segmentationIdRef,
  });


  function mprOnSegmentClick(segmentationId, segIdx) {
    // Toggle the active state of the selected segment

    // Set active property of segmentation
    if (_checkActiveSeg(mprSegmentationsRef.current?.length ? mprSegmentationsRef.current[0] : undefined)) {      
      segmentationService.setActiveSegment(segmentationId, segIdx);
    }
  }


  function mprSetFillAlpha({ type }, value) {
    // Segmentation editor callback for setting the alpha value of the editor segmentation
    
    commandsManager.runCommand('setFillAlpha', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function mprSetOutlineWidth({ type }, value) {
    // Segmentation editor callback for setting the outline width of the editor segmentation
    
    commandsManager.runCommand('setOutlineWidth', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function mprSetRenderFill({ type }, value) {
    // Segmentation editor callback for setting the render/fill options of the editor segmentation
        
    commandsManager.runCommand('setRenderFill', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function mprSetRenderFillInactive({ type }, value) {
    // Segmentation editor callback for setting the render/fill options for inactive segmentations
    
    commandsManager.runCommand('setRenderFillInactive', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function mprSetRenderOutline({ type }, value) {
    // Segmentation editor callback for setting the outline options of the editor segmentation
    
    commandsManager.runCommand('setRenderOutline', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function mprSetRenderOutlineInactive({ type }, value) {
    // Segmentation editor callback for setting the outline options of the editor segmentation
    
    commandsManager.runCommand('setRenderOutlineInactive', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  useEffect(() => {

    // Segmentation representation and style updates
    const { segservice_segrep_updates, segservice_style_updates } = c3dSegUtils.attachSegmentationRepresentationTableEvents({
      segmentationService, displaySetInstanceUID,
      setSegmentations: setMprSegmentations, segmentationsRef: mprSegmentationsRef, setActiveSegmentationId, segmentationIdRef,
      setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef, syncStyleAttrs,
    }, {
      logPrefix: 'SonadorMprSegmentationPanel',
      onAddSegmentationRepresentation: ({ segmentationId }) => {
        // Update style display attributes

        const _style = c3dSegmentations.config.style.getStyle({ segmentationId, type: SegmentationRepresentations.Labelmap, });
        syncStyleAttrs(_style, { force: true });
      }
    });

    // Segmentation Service: segment removed
    const { segservice_segment_removed } = c3dSegUtils.attachSegmentRemovedTableEvents({
      segmentationService, setSegmentations: setMprSegmentations, segmentationsRef: mprSegmentationsRef,
    });

    // First-load: Set active segmentationId from displaySet if already loaded.
    // Update segmentationIdRef.current synchronously so that event handlers (segservice_segdata_modified,
    // segservice_segrep_updates) already registered above can match events that fire before React re-renders.
    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (_ds?.segmentationId && _ds.segmentationId != segmentationIdRef.current) {
      
      setActiveSegmentationId(_ds.segmentationId);
      segmentationIdRef.current = _ds.segmentationId;
      
      setTimeout(() => {
        const _seg = c3dSegmentations.state.getSegmentation(_ds.segmentationId);
        if (_seg) {

          // Translate segmentation data to tableSeg and set first-run state
          setMprSegmentations([c3dSegUtils.c3dSeg2SegmentationTableData(_seg)]);

          // Update style display attributes
          const _style = c3dSegmentations.config.style.getStyle({ segmentationId: _ds.segmentationId, type: SegmentationRepresentations.Labelmap, });
          syncStyleAttrs(_style, { force: true });
        }
      }, eventTimeout);
    }

    return () => {

      // Clear OHIF service subscriptions (all handles expose .unsubscribe())
      segservice_segrep_updates?.unsubscribe();
      segservice_style_updates?.unsubscribe();
      segservice_segment_removed.unsubscribe();

      console.log('[SonadorMprSegmentationPanel:segdata-modified] clear segmentation rep and style callbacks');
    }
  }, [displaySetInstanceUID]);


  useEffect(() => {
    // Update the active segmentationId and editor segmentations reference after a state change.

    segmentationIdRef.current = activeSegmentationId;
    mprSegmentationsRef.current = mprSegmentations;

  }, [activeSegmentationId, mprSegmentations])


  return (<section className={styles.theme} ref={setPortalContainer}>
    <div className={styles.panelWrapper}>
      <TooltipProvider>
      <SegmentationTable title={t('Segmentations')} mode='expanded' portalContainer={portalContainer} 
          data={mprSegmentations} showInactiveSegmentationControls={false} disableEditing={true}
          onToggleSegmentationRepresentationVisibility={mprOnToggleSegmentationRepresentationVisibility}
          onSegmentClick={mprOnSegmentClick} onToggleSegmentVisibility={mprOnToggleSegmentVisibility}               
          renderFill={renderFill} setRenderFill={mprSetRenderFill} 
            renderOutline={renderOutline} setRenderOutline={mprSetRenderOutline}
            renderFillInactive={renderFillInactive} setRenderFillInactive={mprSetRenderFillInactive} 
            renderOutlineInactive={renderOutlineInactive} setRenderOutlineInactive={mprSetRenderOutlineInactive}
            fillAlpha={fillAlpha} setFillAlpha={mprSetFillAlpha}
            outlineWidth={outlineWidth} setOutlineWidth={mprSetOutlineWidth} >

        {activeSegmentationId && (
          <SegmentationTable.Config />
        )}

        <SegmentationTable.Expanded>

          <div className={styles.panelHeader}>
            <SonadorSegmentationHeader portalContainer={portalContainer} />
          </div>

          <div className={styles.panelExpandedContainer}>
          <SegmentationTable.Expanded.Content>
            <div className={styles.panelActions}>
                <SegmentationTable.AddSegmentRow />
            </div>

            <div className={styles.panelSegments}>
              <SegmentationTable.Segments>
                <SegmentationTable.SegmentStatistics.Body />
              </SegmentationTable.Segments>
            </div>
          </SegmentationTable.Expanded.Content>
          </div>
        </SegmentationTable.Expanded>

      </SegmentationTable>
      </TooltipProvider>
   
    </div>
  </section>);
}