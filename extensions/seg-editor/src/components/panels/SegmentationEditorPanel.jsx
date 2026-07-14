import _ from 'lodash';

import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import {
  Enums as c3dToolsEnums,

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

import OHIF from '@ohif/core';
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

import { Enums as SegEditorEnums } from '../../enums';
import { Enums as vtkEnums } from '@ohif/extension-vtk';

const { DisplaySetApi } = OHIF.display;
const { SonadorSegmentationHeader } = csextComponents;

import styles from '@ohif/extension-cornerstone/src/components/SonadorSegmentationPanelTheme.module.scss';



export default function SonadorSegmentationEditorPanel({
    displaySetInstanceUID, commandsManager, servicesManager, eventTimeout = 50, showAddSegment = true }) {
  // React component providing controls for interfacing with the Sonador Segmentation Editor Panel.

  const { t } = useTranslation('SonadorSegmentationEditorPanel');

  const { segmentationService } = servicesManager.services;

  // Component Containers: grounds styling for the editor
  const [portalContainer, setPortalContainer] = useState(null);

  // Active segmentation ID
  const [activeSegmentationId, setActiveSegmentationId] = useState();
  const segmentationIdRef = useRef(activeSegmentationId);
  const [editorSegmentations, setEditorSegmentations] = useState([]);
  const editorSegmentationsRef = useRef(editorSegmentations);


  useEffect(() => {
    // Configure core subscriptions and event handlers

    // displaySet API: UI and data API updates
    const displaysets_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC, ({ apiEvent, ...apiData }) => {
        console.log('[SonadorSegmentationEditorPanel:evt:displayset-datasync]: ', apiEvent, apiData);
      });

    // displaySet API: displaySet changed
    const { displaysets_dataupdate, segservice_segdata_modified } = c3dSegUtils.attachCoreSegmentationTableEvents({
      segmentationService,
      setSegmentations: setEditorSegmentations, segmentationsRef: editorSegmentationsRef, setActiveSegmentationId, segmentationIdRef,
    }, {
      logPrefix: 'SonadorSegmentationEditorPanel',
      onAddSegment: ({ segmentationId, }) => {
        // Update style display attributes

        const _style = c3dSegmentations.config.style.getStyle({ segmentationId, type: SegmentationRepresentations.Labelmap, });
        syncStyleAttrs(_style, { force: true });
      },
    });

    return () => {

      // Clear OHIF service subscriptions (all handles expose .unsubscribe())
      displaysets_apisync.unsubscribe();
      displaysets_dataupdate.unsubscribe();
      segservice_segdata_modified?.unsubscribe();
    }
  }, []);


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

    return c3dSegUtils.checkActiveSeg(seg, editorSegmentationsRef, segmentationIdRef);
  }


  // Synchronize the provided style definition with the configuration attributes in the segmentation table
  const syncStyleAttrs = c3dSegUtils.createSyncStyleAttrsCommand({
    setRenderFillState, renderFillRef, setRenderFillInactiveState, renderFillInactiveRef,
    setRenderOutlineState, renderOutlineRef, setRenderOutlineInactiveState, renderOutlineInactiveRef,
    setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef
  });


  function editorOnToggleSegmentationRepresentationVisibility(segmentationId, segType) {
    // Toggle the visibility of the selected segmentation

    // Retrieve displaySet
    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);

    // Check visibility of segments
    const _visible = c3dSegUtils.tableSgmentationRepVisible(editorSegmentationsRef);
    let segTableVisible;

    // Toggle 2D viewports
    const active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId)
    for (const _v3d_id of active_viewports) {

      // If unable to determine segmentation visibility from the table state, retrieve from c3dSegmentations metadata.
      const visible = !_.isNil(_visible) ? _visible : c3dSegmentations.config.visibility.getSegmentationRepresentationVisibility(_v3d_id, { segmentationId, type: segType });

      // Toggle visibility to opposite state of current
      c3dSegmentations.config.visibility.setSegmentationRepresentationVisibility(_v3d_id, {
        segmentationId, type: segType || c3dToolsEnums.SegmentationRepresentations.Labelmap
      }, !visible);
      segTableVisible = !visible;
    }

    // Toggle 3D viewports
    if (_ds && _ds.volumeSegmentationId) {

      // Retrieve active viewport Ids
      const v3d_active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(_ds.volumeSegmentationId);
      for (const _v3d_id of v3d_active_viewports) {

        // If unable to determine segmentation visibility from the table state, retrieve from c3dSegmentations metadata.
        const visible = !_.isNil(_visible) ? _visible : c3dSegmentations.config.visibility.getSegmentationRepresentationVisibility(_v3d_id, {
          segmentationId: _ds.volumeSegmentationId, type: c3dToolsEnums.SegmentationRepresentations.Surface
        });

        // Toggle visibility to opposite state of current
        c3dSegmentations.config.visibility.setSegmentationRepresentationVisibility(_v3d_id, {
          segmentationId: _ds.volumeSegmentationId, type: c3dToolsEnums.SegmentationRepresentations.Surface,
        }, !visible);
      }
    }

    // Change visibility of segmentation table and mutate state
    if (_checkActiveSeg(editorSegmentationsRef.current?.length ? editorSegmentationsRef.current[0] : undefined)) {
      c3dSegUtils.mutateSegmentationTableRepresentationVisibility(
        segmentationId, setEditorSegmentations, editorSegmentationsRef, segTableVisible);
    }
  }


  function editorOnToggleSegmentVisibility(segmentationId, segIdx, segType, isVisible, options) {
    // Toggle the visibility of the selected segment
    options = options || {};
    _.defaults(options, {
      view2d: true, view3d: true, segTable: true,
    })

    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    let segTableVisible;

    // Toggle 3D viewports
    if (_ds && _ds.volumeSegmentationId && options.view3d) {
      const _v3d_active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(_ds.volumeSegmentationId);
      for (const _v3d_id of _v3d_active_viewports) {

        // Retrieve visibility for the selected segment
        const _visible = !_.isNil(isVisible) ? isVisible : !c3dSegmentations.config.visibility.getSegmentIndexVisibility(
          _v3d_id, { segmentationId: _ds.volumeSegmentationId, type: c3dToolsEnums.SegmentationRepresentations.Surface, }, segIdx);
        c3dSegmentations.config.visibility.setSegmentIndexVisibility(_v3d_id, {
          segmentationId: _ds.volumeSegmentationId, type: c3dToolsEnums.SegmentationRepresentations.Surface,
        }, segIdx, _visible);
      }
    }

    // Toggle 2D viewports
    if (options.view2d) {
      for (const _v3d_id of c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId)) {

        // Retrieve visibility for the selected segment
        const _visible = !_.isNil(isVisible) ? isVisible : !c3dSegmentations.config.visibility.getSegmentIndexVisibility(
          _v3d_id, { segmentationId, type: segType }, segIdx);
        c3dSegmentations.config.visibility.setSegmentIndexVisibility(_v3d_id, { segmentationId, type: segType }, segIdx, _visible);

        // Set segTableVisible from 2D viewport (considered definitive)
        segTableVisible = _visible;
      }
    }

    // Change visibility of segmentation table and mutate state
    if (_checkActiveSeg(editorSegmentationsRef.current?.length ? editorSegmentationsRef.current[0] : undefined) && options.segTable) {

      // Retrieve segement from reference
      const _seg = editorSegmentationsRef.current[0];
      _seg.representation.segments[segIdx].visible = !_.isNil(segTableVisible) ? segTableVisible : isVisible;

      // Mutate componet state
      setEditorSegmentations([_seg]);
    }
  }


  function editorOnSegmentClick(segmentationId, segIdx) {
    // Toggle the active state of the selected segment

    // Set active property of segmentation
    if (_checkActiveSeg(editorSegmentationsRef.current?.length ? editorSegmentationsRef.current[0] : undefined)) {
      segmentationService.setActiveSegment(segmentationId, segIdx);
    }
  }


  async function editorOnSegmentationEdit(evt) {
    // Segmentation editor callback for modifying the segmentation name
    if (segmentationIdRef.current) {
      commandsManager.runCommand('editSegmentationLabel', { segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
    }
  }


  async function editorOnSegmentEdit(segmentationId, segIdx) {
    // Segmentation editor callback for edits

    commandsManager.runCommand('editSegmentLabel', { segmentationId, segmentIndex: segIdx }, vtkEnums.VIEWPORT);
  }


  async function editorOnSegmentColorClick(segmentationId, segIdx) {
    // Segmentation editor callback for changing the segment color

    const active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId);
    if (!active_viewports.length) {
      throw new Error('Unable to edit segment color, no viewports are currently active with the segmentationId='+segmentationId);
    }

    commandsManager.runCommand('editSegmentColor', {
      segmentationId, segmentIndex: segIdx, viewportId: active_viewports[0]
    }, vtkEnums.VIEWPORT);
  }


  function editorOnSegmentDelete(segmentationId, segIdx) {
    // Segmentation editor callback for the deletion of segments

    // Toggle segmentation table and remove from labelmap
    editorOnToggleSegmentVisibility(segmentationId, segIdx, null, false, { view3d: false });
    setTimeout(() => {

      // Trigger start of segment removal
      DisplaySetApi.Instance.displaySetService.triggerApiEvent(
        SegEditorEnums.EVENTS.SEGMENT_REMOVE_PREP, { segmentationId, segmentIndex: segIdx,});

      // Begin synchronous removal. Triggered after signal of segment removal start to allow time for component rendering.
      setTimeout(() => {
        commandsManager.runCommand('deleteSegment', { segmentationId, segmentIndex: segIdx }, vtkEnums.VIEWPORT);
      }, eventTimeout);
    });
  }


  function editorOnToggleSegmentLock(segmentationId, segIdx) {
    // Segmentation editor callback for the locking of segments

    commandsManager.runCommand('toggleSegmentLock', { segmentationId, segmentIndex: segIdx }, vtkEnums.VIEWPORT);
  }


  function editorOnSegmentAdd(segmentationId) {
    // Segmentation editor callback for adding new segments

    commandsManager.runCommand('addSegment', { segmentationId }, vtkEnums.VIEWPORT);
  }


  function editorSetFillAlpha({ type }, value) {
    // Segmentation editor callback for setting the alpha value of the editor segmentation

    commandsManager.runCommand('setFillAlpha', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function editorSetOutlineWidth({ type }, value) {
    // Segmentation editor callback for setting the outline width of the editor segmentation

    commandsManager.runCommand('setOutlineWidth', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function editorSetRenderFill({ type }, value) {
    // Segmentation editor callback for setting the render/fill options of the editor segmentation

    commandsManager.runCommand('setRenderFill', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function editorSetRenderFillInactive({ type }, value) {
    // Segmentation editor callback for setting the render/fill options for inactive segmentations

    commandsManager.runCommand('setRenderFillInactive', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function editorSetRenderOutline({ type }, value) {
    // Segmentation editor callback for setting the outline options of the editor segmentation

    commandsManager.runCommand('setRenderOutline', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }


  function editorSetRenderOutlineInactive({ type }, value) {
    // Segmentation editor callback for setting the outline options of the editor segmentation

    commandsManager.runCommand('setRenderOutlineInactive', { type, value, segmentationId: segmentationIdRef.current }, vtkEnums.VIEWPORT);
  }



  useEffect(() => {
    // Setup subscriptions to the Conrerstone3D Segmentation service

    // Segmentation added
    const { segservice_seg_added }  = c3dSegUtils.attachSegmentationAddTableEvents({
      segmentationService, displaySetInstanceUID, setActiveSegmentationId, segmentationIdRef,
    });

    // Segmentation representation and style updates
    const { segservice_segrep_updates, segservice_style_updates } = c3dSegUtils.attachSegmentationRepresentationTableEvents({
      segmentationService, displaySetInstanceUID,
      setSegmentations: setEditorSegmentations, segmentationsRef: editorSegmentationsRef, setActiveSegmentationId, segmentationIdRef,
      setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef, syncStyleAttrs,
    }, {
      logPrefix: 'SonadorSegmentationEditorPanel',
      onAddSegmentationRepresentation: ({ segmentationId }) => {
        // Update style display attributes

        const _style = c3dSegmentations.config.style.getStyle({ segmentationId, type: SegmentationRepresentations.Labelmap, });
        syncStyleAttrs(_style, { force: true });
      }
    });

    // Segmentation Service: segment removed
    const { segservice_segment_removed } = c3dSegUtils.attachSegmentRemovedTableEvents({
      segmentationService, setSegmentations: setEditorSegmentations, segmentationsRef: editorSegmentationsRef,
    });

    // First-load: Set active segmentationId from displaySet if already loaded.
    // Update segmentationIdRef.current synchronously so that event handlers (c3d_segdata_modified,
    // c3d_segrep_updates) already registered above can match events that fire before React re-renders.
    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (_ds?.segmentationId && _ds.segmentationId != segmentationIdRef.current) {

      setActiveSegmentationId(_ds.segmentationId);
      segmentationIdRef.current = _ds.segmentationId;

      setTimeout(() => {
        const _seg = c3dSegmentations.state.getSegmentation(_ds.segmentationId);
        if (_seg) {

          // Translate segmentation data to tableSeg and set first-run state
          setEditorSegmentations([c3dSegUtils.c3dSeg2SegmentationTableData(_seg)]);

          // Update style display attributes
          const _style = c3dSegmentations.config.style.getStyle({ segmentationId: _ds.segmentationId, type: SegmentationRepresentations.Labelmap, });
          syncStyleAttrs(_style, { force: true });
        }
      }, eventTimeout);
    }

    return () => {

      // Clear OHIF service subscriptions (all handles expose .unsubscribe())
      segservice_seg_added?.unsubscribe();
      segservice_segrep_updates?.unsubscribe();
      segservice_style_updates?.unsubscribe();
      segservice_segment_removed.unsubscribe();

      console.log('[SonadorSegmentationEditorPanel:segdata-modified] clear segmentation rep and style callbacks');
    }
  }, [displaySetInstanceUID]);


  useEffect(() => {
    // Update the active segmentationId and editor segmentations reference after a state change.

    segmentationIdRef.current = activeSegmentationId;
    editorSegmentationsRef.current = editorSegmentations;

  }, [activeSegmentationId, editorSegmentations]);


  return (<section className={styles.theme} ref={setPortalContainer}>
    <div className={styles.panelWrapper}>

      <TooltipProvider>
        <SegmentationTable title={t('Segmentation Editor')} mode='expanded' portalContainer={portalContainer}
            data={editorSegmentations} showInactiveSegmentationControls={false}
            onToggleSegmentationRepresentationVisibility={editorOnToggleSegmentationRepresentationVisibility}
            showAddSegment={showAddSegment} onSegmentClick={editorOnSegmentClick} onSegmentEdit={editorOnSegmentEdit}
              onToggleSegmentVisibility={editorOnToggleSegmentVisibility} onToggleSegmentLock={editorOnToggleSegmentLock}
              onSegmentAdd={editorOnSegmentAdd} onSegmentDelete={editorOnSegmentDelete} onSegmentColorClick={editorOnSegmentColorClick}
            renderFill={renderFill} setRenderFill={editorSetRenderFill}
              renderOutline={renderOutline} setRenderOutline={editorSetRenderOutline}
              renderFillInactive={renderFillInactive} setRenderFillInactive={editorSetRenderFillInactive}
              renderOutlineInactive={renderOutlineInactive} setRenderOutlineInactive={editorSetRenderOutlineInactive}
              fillAlpha={fillAlpha} setFillAlpha={editorSetFillAlpha}
              outlineWidth={outlineWidth} setOutlineWidth={editorSetOutlineWidth} >

          {activeSegmentationId && (
            <SegmentationTable.Config />
          )}


          <SegmentationTable.Expanded>

            <div className={styles.panelHeader}>
            <SonadorSegmentationHeader portalContainer={portalContainer} dropdownMenuContent={(<>
              <DropdownMenuContent container={portalContainer} className="seg-dropdown-content">
              <DropdownMenuItem onClick={editorOnSegmentationEdit} >
                <Icons.Rename className="text-foreground" />
                <span className="pl-2" data-cy="Rename">{t('Rename')}</span>
              </DropdownMenuItem>
              </DropdownMenuContent>
            </>)} />
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
