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

import {
  TooltipProvider,
  SegmentationTable,
} from '@ohif/ui-next';
import {
  components as csextComponents,
  utils as cextUtils,
} from '@ohif/extension-cornerstone';

import {
  cornerstone3dSegmentationUtils as c3dSegUtils
} from '@ohif/extension-viewer3d-volume';

import { isSTLDisplaySet } from '../../sopClassHandlers/OHIFDicom3DSopClassHandler.js';
import { getM3DSegmentationId, DEFAULT_GEOMETRY_COLOR_HEX } from '../../m3dCache';

const { DisplaySetApi } = OHIF.display;
const { SonadorSegmentationHeader } = csextComponents;

import styles from '@ohif/extension-cornerstone/src/components/SonadorSegmentationPanelTheme.module.scss';



export default function M3DViewerSidebarPanel({
  displaySetInstanceUID, commandsManager, servicesManager, eventTimeout = 50,
}) {
  // React component providing controls for interacting with the Sonador M3D Viewer.
  //
  // Model presentation state (visibility, lock/wireframe, colour) is stored in the Cornerstone3D
  // segmentation state registered by OHIFDicomM3DViewport (m3dCache/m3dSegmentationState.js). The
  // M3D/Three.js viewports are not part of the Cornerstone3D rendering system, so the table reads
  // colour and visibility from the segment metadata (source: 'metadata') and mutations are routed
  // through the OHIF segmentationService so SEGMENTATION_MODIFIED/SEGMENT_* events fan out to
  // every subscriber (panel table and all M3D viewports on the series).

  const { t } = useTranslation('M3DViewerSidebarPanel');

  const { segmentationService, UIDialogService } = servicesManager.services;

  // Component Containers: grounds styling for the editor
  const [portalContainer, setPortalContainer] = useState(null);

  // Active segmentation ID
  const [activeSegmentationId, setActiveSegmentationId] = useState();
  const segmentationIdRef = useRef(activeSegmentationId);
  const [m3dSegmentations, setM3dSegmentations] = useState([]);
  const m3dSegmentationsRef = useRef(m3dSegmentations);

  // STL gating: interactive model rows are available for STL series only. GLB series load a
  // complete scene of multiple objects; introspection/interaction is out of scope, so the panel
  // renders the series header only. The STL/GLB distinction is owned by the SOP class handler
  // (isSTLDisplaySet), which the Segmentations-panel visibility gate also consumes.
  const _displaySet = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  const isSTL = isSTLDisplaySet(_displaySet);


  function _refreshTableData(segmentationId) {
    // (Re)generate the segmentation table data from the Cornerstone3D metadata (metadata mode)

    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    if (_seg) {
      setM3dSegmentations([c3dSegUtils.c3dSeg2SegmentationTableData(_seg, { source: 'metadata' })]);
    } else {
      setM3dSegmentations([]);
    }
  }


  function _writeSegments(seg) {
    // Persist mutated segment metadata through the segmentation service so SEGMENTATION_MODIFIED
    // fires and every subscriber (this table, all M3D viewports) re-pulls the current state.

    segmentationService.addOrUpdateSegmentation({
      segmentationId: seg.segmentationId, segments: seg.segments,
    });
  }


  function panelOnToggleSegmentVisibility(segmentationId, segIdx) {
    // Toggle the display of a single model (segments default to visible when the flag is unset)

    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    const _segment = _seg?.segments?.[segIdx];
    if (!_segment) {
      return;
    }

    const visible = _segment.visible !== false;
    _segment.visible = !visible;
    _writeSegments(_seg);
  }


  function panelOnToggleSegmentationRepresentationVisibility(segmentationId) {
    // Toggle the display of all models in the series: if every model is visible hide all,
    // otherwise show all

    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    if (!_seg?.segments) {
      return;
    }

    const allVisible = _.every(_seg.segments, (s) => s.visible !== false);
    _.each(_seg.segments, (s) => { s.visible = !allVisible; });
    _writeSegments(_seg);
  }


  function panelOnToggleSegmentLock(segmentationId, segIdx) {
    // Toggle a model between active (regular rendering) and locked (wireframe rendering).
    // Emits SEGMENT_LOCK, which the M3D viewports translate to material.wireframe.

    segmentationService.toggleSegmentLocked(segmentationId, segIdx);
  }


  function panelOnSegmentClick(segmentationId, segIdx) {
    // Set the active model. Emits SEGMENT_ACTIVE.

    segmentationService.setActiveSegment(segmentationId, segIdx);
  }


  async function panelOnSegmentColorClick(segmentationId, segIdx) {
    // Change a model's colour via the colour picker dialog, seeded from the segment metadata

    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    const _segment = _seg?.segments?.[segIdx];
    if (!_segment) {
      return;
    }

    const [r, g, b] = OHIF.utils.color.hex2rgb(_segment.color || DEFAULT_GEOMETRY_COLOR_HEX);
    const rgbaColor = await cextUtils.callColorPickerDialog({
      uiDialogService: UIDialogService,
      title: 'Select Model Color',
      value: { r, g, b, a: 1 },
      centralize: true,
      isDraggable: false,
      showOverlay: true,
    });

    if (rgbaColor) {
      _segment.color = OHIF.utils.color.rgb2hex(rgbaColor.r, rgbaColor.g, rgbaColor.b);
      _writeSegments(_seg);
    }
  }


  useEffect(() => {
    // Configure core subscriptions and event handlers

    // displaySet added/changed + segmentation data modified (metadata mode: colour/visibility
    // from segment metadata, no registered viewports required). bootstrapEmptyTable populates
    // the table from SEGMENTATION_MODIFIED when the panel is already open while the viewport
    // is still loading/registering — without it, only the first-load block (panel opened after
    // load) fills an empty table.
    const { displaysets_dataupdate, segservice_segdata_modified } = c3dSegUtils.attachCoreSegmentationTableEvents({
      segmentationService,
      setSegmentations: setM3dSegmentations, segmentationsRef: m3dSegmentationsRef, setActiveSegmentationId, segmentationIdRef,
    }, { logPrefix: 'M3DViewerSidebarPanel', source: 'metadata', bootstrapEmptyTable: true, });

    // Segmentation added: bootstrap when the panel mounts before the viewport registers
    const { segservice_seg_added } = c3dSegUtils.attachSegmentationAddTableEvents({
      segmentationService, displaySetInstanceUID, setActiveSegmentationId, segmentationIdRef,
    }, { logPrefix: 'M3DViewerSidebarPanel', });

    // First-load: set the active segmentationId from the displaySet if already registered.
    // Update segmentationIdRef.current synchronously so the handlers above can match events
    // that fire before React re-renders.
    const _ds0 = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (_ds0?.segmentationId && _ds0.segmentationId != segmentationIdRef.current) {
      setActiveSegmentationId(_ds0.segmentationId);
      segmentationIdRef.current = _ds0.segmentationId;
    }

    return () => {

      // Clear OHIF service subscriptions (all handles expose .unsubscribe())
      displaysets_dataupdate.unsubscribe();
      segservice_segdata_modified?.unsubscribe();
      segservice_seg_added?.unsubscribe();
    }

  }, []);


  useEffect(() => {
    // Populate the segmentation table when the active segmentation becomes available. The M3D
    // viewports never attach segmentation representations, so (unlike the editor panels) there is
    // no SEGMENTATION_REPRESENTATION_MODIFIED bootstrap — table data is generated whenever the
    // active segmentationId lands.

    segmentationIdRef.current = activeSegmentationId;
    if (activeSegmentationId) {
      _refreshTableData(activeSegmentationId);
    }
  }, [activeSegmentationId]);


  useEffect(() => {
    // Cache a copy of the table segmentations for the event handlers

    m3dSegmentationsRef.current = m3dSegmentations;
  }, [m3dSegmentations]);


  // GLB series: series header only — synthesize a single header entry so the
  // SonadorSegmentationHeader renders the series title with no rows or actions.
  const glbSegmentations = !isSTL && _displaySet ? [{
    segmentation: {
      segmentationId: getM3DSegmentationId(_displaySet.SeriesInstanceUID),
      label: _displaySet.SeriesDescription || t('Model'),
      segments: {},
    },
    representation: {
      active: true, visible: true,
      type: SegmentationRepresentations.Labelmap,
      segments: {},
    },
  }] : [];

  return (<section className={styles.theme} ref={setPortalContainer}>
    <div className={styles.panelWrapper}>
      <TooltipProvider>

        {isSTL && (
        <SegmentationTable title={t('Models')} mode='expanded' portalContainer={portalContainer}
            data={m3dSegmentations} showInactiveSegmentationControls={false}
            disableEditing={false} showAddSegment={false}
            onToggleSegmentationRepresentationVisibility={panelOnToggleSegmentationRepresentationVisibility}
            onToggleSegmentVisibility={panelOnToggleSegmentVisibility}
            onToggleSegmentLock={panelOnToggleSegmentLock}
            onSegmentClick={panelOnSegmentClick}
            onSegmentColorClick={panelOnSegmentColorClick} >

          <SegmentationTable.Expanded>

            <div className={styles.panelHeader}>
              <SonadorSegmentationHeader portalContainer={portalContainer} />
            </div>

            <div className={styles.panelExpandedContainer}>
            <SegmentationTable.Expanded.Content>

              {/* AddSegmentRow with showAddSegment=false renders the whole-series
                  visibility toggle only (no Add Segment button) */}
              <div className={styles.panelActions}>
                <SegmentationTable.AddSegmentRow />
              </div>

              <div className={styles.panelSegments}>
                <SegmentationTable.Segments />
              </div>
            </SegmentationTable.Expanded.Content>
            </div>

          </SegmentationTable.Expanded>
        </SegmentationTable>
        )}

        {!isSTL && (
        <SegmentationTable title={t('Models')} mode='expanded' portalContainer={portalContainer}
            data={glbSegmentations} showInactiveSegmentationControls={false} disableEditing={true} >

          <SegmentationTable.Expanded>
            <div className={styles.panelHeader}>
              <SonadorSegmentationHeader portalContainer={portalContainer} />
            </div>
          </SegmentationTable.Expanded>
        </SegmentationTable>
        )}

      </TooltipProvider>
    </div>
  </section>);
}


M3DViewerSidebarPanel.propTypes = {
  displaySetInstanceUID: PropTypes.string,
  commandsManager: PropTypes.object,
  servicesManager: PropTypes.object.isRequired,
  eventTimeout: PropTypes.number,
};
