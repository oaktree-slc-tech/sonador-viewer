// OHIF Segmentation Panel
import _ from 'lodash';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import classNames from 'classnames';
import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';
import moment from 'moment';
import PropTypes from 'prop-types';

import { log, utils } from '@ohif/core';

import { CustomSelect, Icon, TableList } from '@ohif/ui';
import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';
import {
  Icons, ScrollArea, SegmentationTable, TooltipProvider,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Tooltip, TooltipTrigger, TooltipContent,
} from '@ohif/ui-next';
import {
  components as csextComponents
} from '@ohif/extension-cornerstone';
import panelStyles from '@ohif/extension-cornerstone/src/components/SonadorSegmentationPanelTheme.module.scss';

import { setSegmentationEditorLayout, SonadorSegmentationEditorPanel } from '@ohif/extension-seg3d-editor';
import { SonadorVolumeViewerPanel, } from '@ohif/extension-viewer3d-volume';
import { M3DViewerSidebarPanel, } from '@ohif/extension-viewerm3d';

import DICOMSegTempCrosshairsTool from '../../tools/DICOMSegTempCrosshairsTool';
import refreshViewports from '../../utils/refreshViewports';
import setActiveLabelmap from '../../utils/setActiveLabelMap';
import { BrushColorSelector, BrushRadius, SegmentItem } from '../index';
import SegmentationSettings from '../SegmentationSettings/SegmentationSettings';

import SonadorMprSegmentationPanel from './SonadorMprSegmentationPanel';

import './SegmentationPanel.css';

const { studyMetadataManager } = utils;
const { SonadorSegmentationHeader } = csextComponents


/**
 * SegmentationPanel component
 *
 * @param {Array} props.studies - Studies data
 * @param {Array} props.viewports - Viewports data (viewportSpecificData)
 * @param {Object} props.layout - Current viewport layout (state.viewports.layout)
 * @param {number} props.activeIndex - Active viewport index
 * @param {boolean} props.isOpen - Boolean that indicates if the panel is expanded
 * @param {Function} props.onSegmentItemClick - Segment click handler
 * @param {Function} props.onSegmentVisibilityChange - Segment visibiliy change handler
 * @param {Function} props.onConfigurationChange - Configuration change handler
 * @param {Function} props.activeContexts - List of active application contexts
 * @param {Function} props.contexts - List of available application contexts
 * @param {Function} props.servicesManager - Services manager
 * @returns component
 */
const SegmentationPanel = ({
  studies,
  viewports,
  layout,
  activeIndex,
  isOpen,
  onSegmentItemClick,
  onSegmentVisibilityChange,
  onConfigurationChange,
  onDisplaySetLoadFailure,
  onSelectedSegmentationChange,
  activeContexts = [],
  contexts = {},
  servicesManager,
  commandsManager,
}) => {

  const { t } = useTranslation('SegmentationPanel');

  // Check for active viewport type
  const isVTK = () => activeContexts.includes(contexts.VTK);
  const isViewerVol3d = () => activeContexts.includes(contexts.VIEWER3DVOL);
  const isCornerstone = () => activeContexts.includes(contexts.CORNERSTONE);
  const isSegEditor = () => activeContexts.includes(contexts.SONADOR3DSEG);
  const isViewerM3d = () => activeContexts.includes(contexts.M3D);  

  /*
   * TODO: wrap get/set interactions with the cornerstoneTools
   * store with context to make these kind of things less blurry.
   */
  const { configuration } = cornerstoneTools.getModule('segmentation');
  if (configuration.segsTolerance === undefined) {
    configuration.segsTolerance = 1e-2;
  }
  const DEFAULT_BRUSH_RADIUS = configuration.radius || 10;

  /*
   * TODO: We shouldn't hardcode brushColor color, in the future
   * the SEG may set the colorLUT to whatever it wants.
   */
  const [state, setState] = useState({
    brushRadius: DEFAULT_BRUSH_RADIUS,
    brushColor: 'rgba(221, 85, 85, 1)',
    selectedSegment: 0,
    selectedSegmentation: 0,
    showSettings: false,
    labelMapList: [],
    segmentData: {},
    segmentsHidden: [],
    segmentNumbers: [],
    isLoading: false,
    isDisabled: true,
    // Mirror of cornerstoneTools configuration for reactive re-renders in SegmentationTable.Config
    displayConfig: {
      fillAlpha:                     configuration.fillAlpha                     ?? 0.5,
      fillAlphaInactive:             configuration.fillAlphaInactive             ?? 0.2,
      outlineWidth:                  configuration.outlineWidth                  ?? 1,
      renderFill:                    configuration.renderFill                    ?? true,
      renderOutline:                 configuration.renderOutline                 ?? true,
      renderFillInactive:            configuration.renderFillInactive            ?? true,
      renderOutlineInactive:         configuration.renderOutlineInactive         ?? true,
      shouldRenderInactiveLabelmaps: configuration.shouldRenderInactiveLabelmaps ?? true,
    },
  });

  const [portalContainer, setPortalContainer] = useState(null);

  const getActiveViewport = () => viewports[activeIndex];

  const getFirstImageId = () => {
    const viewport = getActiveViewport();
    if (!viewport) return null;
    const { StudyInstanceUID, displaySetInstanceUID } = viewport;
    const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
    if (!studyMetadata) return null;
    return studyMetadata.getFirstImageId(displaySetInstanceUID);
  };

  const getAllSegDisplaySets = () => {
    const { StudyInstanceUID } = getActiveViewport();
    const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
    return studyMetadata.getDerivedDatasets({
      Modality: 'SEG',
    });
  };

  const updateSegDisplaySetsTolerance = (tolerance) => {
    const segDisplaySets = getAllSegDisplaySets();
    segDisplaySets.forEach((segDisplaySet) => {
      // update tol value
      segDisplaySet.tolerance = tolerance;
      // reset load flags for allowing retry for seg parsing.
      segDisplaySet.isLoaded = false;
      segDisplaySet.loadError = false;
    });
  };

  const getActiveLabelMaps3D = () => {
    const { labelmaps3D, activeLabelmapIndex } = getBrushStackState();
    return labelmaps3D[activeLabelmapIndex];
  };

  const getActiveLabelMapIndex = () => {
    const { activeLabelmapIndex } = getBrushStackState();
    return activeLabelmapIndex;
  };

  const getActiveSegmentIndex = () => {
    const { activeSegmentIndex } = getActiveLabelMaps3D();
    return activeSegmentIndex;
  };

  const getActiveLabelMaps2D = () => {
    const { labelmaps2D } = getActiveLabelMaps3D();
    return labelmaps2D;
  };

  const getCurrentDisplaySet = () => {
    // Retrieve the current display sets for the active viewport

    const { StudyInstanceUID, displaySetInstanceUID } = getActiveViewport();
    const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
    const allDisplaySets = studyMetadata.getDisplaySets();
    return allDisplaySets.find((ds) => ds.displaySetInstanceUID === displaySetInstanceUID);
  };

  const getSiblingLabelmapIndices = (displaySet) => {
    // Return all cornerstone-tools labelmap indices that belong to the same SEG displaySet.
    // For non-overlapping SEGs this is always a single-element array.
    // For overlapping SEGs the loader split the data across multiple labelmaps, each stored
    // under a key in `labelmapSegments`; we collect all of those indices here.
    if (!displaySet) return [];
    if (displaySet.hasOverlapping && displaySet.labelmapSegments) {
      return Object.keys(displaySet.labelmapSegments).map(Number);
    }
    return [Number(displaySet.labelmapIndex)];
  };

  const getActiveSegDisplaySet = () => {
    // Find which SEG displaySet owns the currently active labelmap index so that sibling
    // indices can be resolved even after the active labelmap has been switched mid-session.
    const activeIdx = Number(getActiveLabelMapIndex());
    return getAllSegDisplaySets().find((ds) => {
      if (ds.hasOverlapping && ds.labelmapSegments) {
        return Object.keys(ds.labelmapSegments).map(Number).includes(activeIdx);
      }
      return Number(ds.labelmapIndex) === activeIdx;
    }) ?? null;
  };

  const setActiveSegment = (segmentIndex, segmentationId) => {
    // Set the active segment

    const activeSegmentIndex = getActiveSegmentIndex();
    const activeViewport = getActiveViewport();

    if (segmentIndex === activeSegmentIndex) {
      log.info(`${activeSegmentIndex} is already the active segment`);
      return;
    }

    const labelmap3D = getActiveLabelMaps3D();
    labelmap3D.activeSegmentIndex = segmentIndex;

    /**
     * Activates the correct label map if clicked segment
     * does not belong to the active labelmap.
     *
     * When segmentationId is provided (displaySetInstanceUID), restrict the
     * search to that specific displaySet so that overlapping segment indices
     * across different SEGs do not corrupt the active labelmap selection.
     */
    const { StudyInstanceUID } = activeViewport;
    const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
    const allDisplaySets = studyMetadata.getDisplaySets();
    let selectedSegmentation;
    let newLabelmapIndex = getActiveLabelMapIndex();
    allDisplaySets.forEach((displaySet) => {
      if (segmentationId && displaySet.displaySetInstanceUID !== segmentationId) {
        return;
      }
      if (displaySet.labelmapSegments) {
        Object.keys(displaySet.labelmapSegments).forEach((labelmapIndex) => {
          if (displaySet.labelmapSegments[labelmapIndex].includes(segmentIndex)) {
            newLabelmapIndex = labelmapIndex;
            selectedSegmentation = displaySet.hasOverlapping === true ? displaySet.originLabelMapIndex : labelmapIndex;
          }
        });
      }
    });

    const brushStackState = getBrushStackState();
    brushStackState.activeLabelmapIndex = newLabelmapIndex;
    if (selectedSegmentation) {
      setState((state) => ({ ...state, selectedSegmentation }));
    }

    refreshViewports();

    return segmentIndex;
  };

  useEffect(() => {
    const labelmapModifiedHandler = (event) => {
      log.warn('Segmentation Panel: labelmap modified', event);
      refreshSegmentations();
    };

    /*
     * TODO: Improve the way we notify parts of the app that depends on segs to be loaded.
     *
     * Currently we are using a non-ideal implementation through a custom event to notify the segmentation panel
     * or other components that could rely on loaded segmentations that
     * the segments were loaded so that e.g. when the user opens the panel
     * before the segments are fully loaded, the panel can subscribe to this custom event
     * and update itself with the new segments.
     *
     * This limitation is due to the fact that the cs segmentation module is an object (which will be
     * updated after the segments are loaded) that React its not aware of its changes
     * because the module object its not passed in to the panel component as prop but accessed externally.
     *
     * Improving this event approach to something reactive that can be tracked inside the react lifecycle,
     * allows us to easily watch the module or the segmentations loading process in any other component
     * without subscribing to external events.
     */
    document.addEventListener('extensiondicomsegmentationsegloaded', refreshSegmentations);
    document.addEventListener('extensiondicomsegmentationsegselected', updateSegmentationComboBox);

    /*
     * These are specific to each element;
     * Need to iterate cornerstone-tools tracked enabled elements?
     * Then only care about the one tied to active viewport?
     */
    cornerstoneTools.store.state.enabledElements.forEach((enabledElement) =>
      enabledElement.addEventListener('cornerstonetoolslabelmapmodified', labelmapModifiedHandler)
    );

    return () => {
      document.removeEventListener('extensiondicomsegmentationsegloaded', refreshSegmentations);
      document.removeEventListener('extensiondicomsegmentationsegselected', updateSegmentationComboBox);
      cornerstoneTools.store.state.enabledElements.forEach((enabledElement) =>
        enabledElement.removeEventListener('cornerstonetoolslabelmapmodified', labelmapModifiedHandler)
      );
    };
  }, [activeIndex, viewports]);

  const updateSegmentationComboBox = (e) => {
    const index = e.detail.activatedLabelmapIndex;
    if (index !== -1) {
      setState((state) => ({ ...state, selectedSegmentation: index }));
    }
  };

  const refreshSegmentations = () => {
    const activeViewport = getActiveViewport();
    const isDisabled = !activeViewport || !activeViewport.StudyInstanceUID;
    if (!isDisabled) {
      const brushStackState = getBrushStackState();
      const activeLm3D = brushStackState?.labelmaps3D?.[brushStackState.activeLabelmapIndex];
      if (brushStackState && activeLm3D) {
        const labelMapList = getLabelMapList();
        const { data: segmentData, numbers: segmentNumbers, segmentsHidden } = getSegmentList();
        setState((state) => ({
          ...state,
          segmentsHidden,
          segmentNumbers,
          labelMapList,
          segmentData,
          isDisabled,
        }));
      } else {
        setState((state) => ({
          ...state,
          segmentsHidden: [],
          segmentNumbers: [],
          labelMapList: [],
          segmentData: {},
          isDisabled,
        }));
      }
    } else {
      // Viewport was cleared (e.g. study reload in progress). Reset stale segment
      // state so the panel doesn't display old segments while the reload is pending.
      setState((state) => ({
        ...state,
        segmentsHidden: [],
        segmentNumbers: [],
        labelMapList: [],
        segmentData: {},
        isDisabled: true,
      }));
    }
  };

  useEffect(() => {
    refreshSegmentations();
  }, [viewports, activeIndex, isOpen, state.selectedSegmentation, activeContexts, state.isLoading]);

  
  /* Handle open/closed panel behaviour */
  useEffect(() => {
    setState((state) => ({
      ...state,
      showSettings: state.showSettings && !isOpen,
    }));
  }, [isOpen]);

  const getLabelMapList = () => {
    const activeViewport = getActiveViewport();

    /* Get list of SEG labelmaps specific to active viewport (reference series) */
    const referencedSegDisplaysets = _getReferencedSegDisplaysets(
      activeViewport.StudyInstanceUID,
      activeViewport.SeriesInstanceUID
    );

    const filteredReferencedSegDisplaysets = referencedSegDisplaysets.filter(
      (segDisplay) => segDisplay.loadError !== true
    );

    return filteredReferencedSegDisplaysets.map((displaySet, index) => {
      const { labelmapIndex, originLabelMapIndex, hasOverlapping, SeriesDate, SeriesTime } = displaySet;

      /* Map to display representation */
      const dateStr = `${SeriesDate}:${SeriesTime}`.split('.')[0];
      const date = moment(dateStr, 'YYYYMMDD:HHmmss');
      const displayDate = date.format('ddd, MMM Do YYYY, h:mm:ss a');
      const displayDescription = displaySet.SeriesDescription;

      // Collect all sibling labelmap indices for this SEG so that downstream consumers
      // (SonadorVolumeViewerPanel, visibility handlers) can merge overlapping labelmaps.
      const siblingLabelmapIndices = getSiblingLabelmapIndices(displaySet);

      return {
        uid: displaySet.displaySetInstanceUID,
        value: (hasOverlapping === true ? originLabelMapIndex : labelmapIndex),
        siblingLabelmapIndices,
        title: displayDescription,
        description: displayDate,
        onClick: async () => {
          // Step 1: restore visibility for this SEG's sibling slots BEFORE the async load.
          // This eliminates a race window where refreshSegmentations() could fire during the
          // await (e.g. triggered by a viewport change) and read still-suppressed segmentsHidden,
          // causing the segments table to briefly — or permanently — show segments as hidden.
          const brushStackState = getBrushStackState();
          const activeSeriesInstanceUID = displaySet.SeriesInstanceUID;
          if (brushStackState) {
            siblingLabelmapIndices.forEach((idx) => {
              const lm3D = brushStackState.labelmaps3D[idx];
              if (lm3D) {
                lm3D.segmentsHidden = lm3D.segmentsHidden.map(() => false);
              }
            });
          }

          const activatedLabelmapIndex = await setActiveLabelmap(
            activeViewport,
            studies,
            displaySet,
            onSelectedSegmentationChange,
            onDisplaySetLoadFailure
          );

          // Step 2: suppress stale "ghost" labelmaps after activation.
          //
          // cornerstone-tools defaults shouldRenderInactiveLabelmaps = true, so every slot in
          // labelmaps3D[] except the active one is composited on every render.  When the same SEG
          // is reloaded its old slot stays in the array and renders as a ghost overlay.
          //
          // We only suppress slots that share the SAME SeriesInstanceUID as the newly activated
          // SEG AND are not in its sibling set.  Labelmaps belonging to OTHER SEG displaySets are
          // left untouched so that shouldRenderInactiveLabelmaps continues to control their display.
          if (brushStackState) {
            brushStackState.labelmaps3D.forEach((lm3D, idx) => {
              if (!lm3D || siblingLabelmapIndices.includes(idx)) return;

              const lmSeriesUID = lm3D.metadata?.segmentationSeriesInstanceUID;
              if (lmSeriesUID && lmSeriesUID === activeSeriesInstanceUID) {
                // Ghost: a stale slot from a previous load of this same SEG series.
                const segIndices = new Set(
                  lm3D.labelmaps2D
                    .flatMap((lm2D) => lm2D?.segmentsOnLabelmap ?? [])
                    .filter((i) => i !== 0)
                );
                segIndices.forEach((segIdx) => {
                  lm3D.segmentsHidden[segIdx] = true;
                });
              }
              // Else: belongs to a different SEG displaySet — leave segmentsHidden alone.
            });

            // Render pass after ghost suppression so the canvas is clean.
            refreshViewports();
          }

          setState((state) => ({
            ...state,
            selectedSegmentation: activatedLabelmapIndex,
          }));
        },
      };
    });
  };

  const setCurrentSelectedSegment = (segmentNumber, segmentationId) => {
    setActiveSegment(segmentNumber, segmentationId);

    const sameSegment = state.selectedSegment === segmentNumber;
    if (!sameSegment) {
      setState((state) => ({ ...state, selectedSegment: segmentNumber }));
    }

    const validIndexList = [];
    getActiveLabelMaps2D().forEach((labelMap2D, index) => {
      if (labelMap2D.segmentsOnLabelmap.includes(segmentNumber)) {
        validIndexList.push(index);
      }
    });

    const avg = (array) => array.reduce((a, b) => a + b) / array.length;
    const average = avg(validIndexList);
    const closest = validIndexList.reduce((prev, curr) => {
      return Math.abs(curr - average) < Math.abs(prev - average) ? curr : prev;
    });

    if (isCornerstone()) {
      const element = getEnabledElement();
      const toolState = cornerstoneTools.getToolState(element, 'stack');

      if (!toolState) return;

      const imageIds = toolState.data[0].imageIds;
      const imageId = imageIds[closest];
      const frameIndex = imageIds.indexOf(imageId);

      const SOPInstanceUID = cornerstone.metaData.get('SOPInstanceUID', imageId);
      const StudyInstanceUID = cornerstone.metaData.get('StudyInstanceUID', imageId);

      DICOMSegTempCrosshairsTool.addCrosshair(element, imageId, segmentNumber);

      onSegmentItemClick({
        StudyInstanceUID,
        SOPInstanceUID,
        frameIndex,
        activeViewportIndex: activeIndex,
      });
    }

    if (isVTK()) {
      const labelMaps3D = getActiveLabelMaps3D();
      const currentDisplaySet = getCurrentDisplaySet();
      const frame = labelMaps3D.labelmaps2D[closest];

      onSegmentItemClick({
        studies,
        StudyInstanceUID: currentDisplaySet.StudyInstanceUID,
        displaySetInstanceUID: currentDisplaySet.displaySetInstanceUID,
        SOPClassUID: getActiveViewport().sopClassUIDs[0],
        SOPInstanceUID: currentDisplaySet.SOPInstanceUID,
        segmentNumber,
        frameIndex: closest,
        frame,
      });
    }
  };

  const getColorLUTTable = () => {
    const labelmap3D = getActiveLabelMaps3D();
    if (!labelmap3D) return null;
    const { state } = cornerstoneTools.getModule('segmentation');
    const { colorLUTIndex } = labelmap3D;
    return state.colorLutTables[colorLUTIndex];
  };

  const getEnabledElement = () => {
    const enabledElements = cornerstone.getEnabledElements();
    return enabledElements[activeIndex].element;
  };

  const onSegmentVisibilityChangeHandler = (isVisible, segmentNumber, labelmap3D) => {
    let segmentsHidden = [];
    if (labelmap3D.metadata.hasOverlapping) {
      /** Get all labelmaps with this segmentNumber and that
       * are from the same series (overlapping segments) */
      const { labelmaps3D } = getBrushStackState();

      const sameSeriesLabelMaps3D = labelmaps3D.filter(({ metadata }) => {
        return labelmap3D.metadata.segmentationSeriesInstanceUID === metadata.segmentationSeriesInstanceUID;
      });

      const possibleLabelMaps3D = sameSeriesLabelMaps3D.filter(({ labelmaps2D }) => {
        return labelmaps2D.some(({ segmentsOnLabelmap }) => segmentsOnLabelmap.includes(segmentNumber));
      });

      possibleLabelMaps3D.forEach((labelmap3D) => {
        labelmap3D.segmentsHidden[segmentNumber] = !isVisible;

        segmentsHidden = [...new Set([...segmentsHidden, ...labelmap3D.segmentsHidden])];
      });
    } else {
      labelmap3D.segmentsHidden[segmentNumber] = !isVisible;
      segmentsHidden = [...labelmap3D.segmentsHidden];
    }

    setState((state) => ({ ...state, segmentsHidden }));

    refreshSegmentations();
    refreshViewports();

    if (isVTK()) {
      onSegmentVisibilityChange(segmentNumber, isVisible);
    }
  };

  const getSegmentList = () => {
    // Retrieve segment list

    const { labelmaps3D } = getBrushStackState();
    const activeSegDs = getActiveSegDisplaySet();
    const siblingIndices = getSiblingLabelmapIndices(activeSegDs);

    // Collect unique non-zero segment indices across all sibling labelmaps so that
    // every segment belonging to this SEG series is represented, even when the loader
    // split overlapping segments across multiple cornerstone-tools labelmap slots.
    const uniqueSegmentIndexes = [
      ...new Set(
        siblingIndices.flatMap((idx) => {
          const lm3D = labelmaps3D[idx];
          if (!lm3D) return [];
          return lm3D.labelmaps2D.flatMap((lm2D) => lm2D?.segmentsOnLabelmap ?? []);
        }).filter((idx) => idx !== 0)
      ),
    ].sort((a, b) => a - b);

    // The origin / active labelmap carries the authoritative DICOM metadata and the
    // color LUT for the whole series, so use it as the metadata/color source.
    const labelmap3D = getActiveLabelMaps3D();
    const colorLutTable = getColorLUTTable();
    const hasLabelmapMeta = labelmap3D?.metadata?.data;

    // Aggregate hidden flags across all siblings so toggling a segment on one labelmap
    // is reflected when the active labelmap switches to a sibling.
    const aggregatedHidden = siblingIndices.reduce((acc, idx) => {
      const lm3D = labelmaps3D[idx];
      if (lm3D?.segmentsHidden) {
        lm3D.segmentsHidden.forEach((hidden, segIdx) => {
          if (hidden) acc[segIdx] = true;
        });
      }
      return acc;
    }, {});

    const segmentData = {};
    const segmentNumbers = [];

    uniqueSegmentIndexes.forEach((segmentIndex) => {
      const color = colorLutTable[segmentIndex] ?? [255, 255, 255, 255];
      let label = '(unlabeled)';
      let segmentNumber = segmentIndex;

      if (hasLabelmapMeta) {
        const meta = labelmap3D.metadata.data[segmentIndex];
        if (meta) {
          segmentNumber = meta.SegmentNumber;
          label = meta.SegmentLabel;
        }
      }

      segmentNumbers.push(segmentNumber);
      segmentData[segmentNumber] = {
        segmentIndex: segmentNumber,
        label,
        color,
        visible: !aggregatedHidden[segmentIndex],
        active: state.selectedSegment === segmentNumber,
      };
    });

    // Flat hidden array (indexed by segment number) retained for backward-compatible
    // callers such as onVisibilityChangeHandler that still write into labelmap3D.segmentsHidden.
    const segmentsHidden = uniqueSegmentIndexes.map((idx) => !!aggregatedHidden[idx]);

    return { data: segmentData, numbers: segmentNumbers, segmentsHidden };
  };

  const updateBrushSize = (evt) => {
    const updatedRadius = Number(evt.target.value);

    if (updatedRadius !== state.brushRadius) {
      setState((state) => ({ ...state, brushRadius: updatedRadius }));
      const module = cornerstoneTools.getModule('segmentation');
      module.setters.radius(updatedRadius);
    }
  };

  const decrementSegment = (event) => {
    let activeSegmentIndex = getActiveSegmentIndex();
    event.preventDefault();
    if (activeSegmentIndex > 1) {
      activeSegmentIndex--;
    }
    setState((state) => ({ ...state, selectedSegment: activeSegmentIndex }));
    updateActiveSegmentColor();
  };

  const incrementSegment = (event) => {
    let activeSegmentIndex = getActiveSegmentIndex();
    event.preventDefault();
    activeSegmentIndex++;
    setState((state) => ({ ...state, selectedSegment: activeSegmentIndex }));
    updateActiveSegmentColor();
  };

  const updateActiveSegmentColor = () => {
    const color = getActiveSegmentColor();
    setState((state) => ({ ...state, brushColor: color }));
  };

  const getBrushStackState = () => {
    const firstImageId = getFirstImageId();
    if (!firstImageId) return null;
    const module = cornerstoneTools.getModule('segmentation');
    const brushStackState = module.state.series[firstImageId];
    return brushStackState;
  };

  const getActiveSegmentColor = () => {
    const brushStackState = getBrushStackState();
    if (!brushStackState) {
      return 'rgba(255, 255, 255, 1)';
    }

    const colorLutTable = getColorLUTTable();
    const color = colorLutTable[labelmap3D.activeSegmentIndex];
    return `rgba(${color.join(',')})`;
  };

  const updateConfiguration = (newConfiguration) => {
    // Update the display configuration for the viewport

    const previousTolerance = configuration.segsTolerance;
    configuration.renderFill = newConfiguration.renderFill;
    configuration.renderOutline = newConfiguration.renderOutline;
    configuration.shouldRenderInactiveLabelmaps = newConfiguration.shouldRenderInactiveLabelmaps;
    configuration.fillAlpha = newConfiguration.fillAlpha;
    configuration.outlineAlpha = newConfiguration.outlineAlpha;
    configuration.outlineWidth = newConfiguration.outlineWidth;
    configuration.fillAlphaInactive = newConfiguration.fillAlphaInactive;
    configuration.outlineAlphaInactive = newConfiguration.outlineAlphaInactive;
    configuration.segsTolerance = newConfiguration.segsTolerance;

    // Sync the React-visible mirror so SegmentationTable.Config re-renders with new values.
    // Without this, configuration is mutated but React never sees a change, leaving the
    // Config widgets frozen at their initial values.
    setState((prev) => ({
      ...prev,
      displayConfig: {
        fillAlpha:                     configuration.fillAlpha                     ?? 0.5,
        fillAlphaInactive:             configuration.fillAlphaInactive             ?? 0.2,
        outlineWidth:                  configuration.outlineWidth                  ?? 1,
        renderFill:                    configuration.renderFill                    ?? true,
        renderOutline:                 configuration.renderOutline                 ?? true,
        renderFillInactive:            configuration.renderFillInactive            ?? true,
        renderOutlineInactive:         configuration.renderOutlineInactive         ?? true,
        shouldRenderInactiveLabelmaps: configuration.shouldRenderInactiveLabelmaps ?? true,
      },
    }));

    onConfigurationChange(newConfiguration);
    // Only reset isLoaded on displaySets when tolerance actually changes — calling this
    // unconditionally resets isLoaded = false on every config tweak, which triggers the
    // viewer to re-load SEGs and dispatch extensiondicomsegmentationsegselected with a
    // fresh labelmapIndex, causing the active segmentation to snap back to the first item.
    if (newConfiguration.segsTolerance !== previousTolerance) {
      updateSegDisplaySetsTolerance(configuration.segsTolerance);
    }
    refreshViewports();
  };


  const panelUpdateConfig = (newConfig) => {
    // Compatbility method to help translate between Cornerstone Tools (Classic) and OHIF-v3 Segmentation Table.

    // Back-fill missing values from current configuration
    _.defaults(newConfig, _.pick(configuration, 'renderFill', 'renderOutline', 'shouldRenderInactiveLabelmaps',
      'fillAlpha', 'outlineAlpha', 'outlineWidth', 'fillAlphaInactive', 'outlineAlphaInactive', 'segsTolerance'));
    updateConfiguration(newConfig);
  }

  
  const onVisibilityChangeHandler = (isVisible) => {
    let segmentsHidden = [];
    const labelmap3D = getActiveLabelMaps3D();

    state.segmentNumbers.forEach((segmentNumber) => {
      if (isVTK()) {
        onSegmentVisibilityChange(segmentNumber, isVisible);
      }

      labelmap3D.segmentsHidden[segmentNumber] = !isVisible;
      segmentsHidden = [...new Set([...segmentsHidden, ...labelmap3D.segmentsHidden])];
    });

    setState((state) => ({ ...state, segmentsHidden }));

    refreshSegmentations();
    refreshViewports();
  };

  const onShowSegmentationEditor = () => {
    // Load the editor the currently selected series and seg
    const { setIsDisplayedLayoutButton } = useLayoutButton.getState();

    if (commandsManager) {
      // Toggle layout button and display semgentation editor
      setIsDisplayedLayoutButton(false);
      commandsManager.runCommand('segmentationEditor');
    }
  };

  const disabledConfigurationFields = ['outlineAlpha', 'shouldRenderInactiveLabelmaps'];

  // Derive the selected segmentation option from the cornerstone-tools ground truth rather than
  // from state.selectedSegmentation, which can go stale if an external event (e.g. a SEG re-load
  // triggered by tolerance reset) fires extensiondicomsegmentationsegselected with a new index.
  // siblingLabelmapIndices covers overlapping SEGs where the active index is a non-origin sibling.
  const brushState = !state.isDisabled ? getBrushStackState() : null;
  const activeLabelmapIdx = brushState ? Number(brushState.activeLabelmapIndex) : -1;
  const selectedSegmentationOption = activeLabelmapIdx >= 0
    ? state.labelMapList.find((item) =>
        item.siblingLabelmapIndices?.includes(activeLabelmapIdx) ||
        Number(item.value) === activeLabelmapIdx
      )
    : state.labelMapList.find((item) => Number(item.value) === Number(state.selectedSegmentation));

  
  function panelOnToggleSegmentVisibility(segmentationId, segIdx, segType, isVisible, options) {
    // Segmentation table callback to manage toggle of a segment

    // Back-fill the current state of isVisible from the segments array
    if (_.isNil(isVisible)) {
      const labelmap3D = getActiveLabelMaps3D();
      isVisible = labelmap3D.segmentsHidden[segIdx];
    }

    onSegmentVisibilityChangeHandler(isVisible, segIdx, getActiveLabelMaps3D());
  }


  // Display state functions: display helpers for actions and UI elements

  const getDisplayedViewportCount = () => {
    // Number of viewports currently on screen.
    //
    // Read this from the layout, not from the keys of viewportSpecificData: that data is keyed by
    // viewport index and can outlive the layout which created it (e.g. leaving a 1x3 MPR layout by
    // clicking a series thumbnail), which left the editor launch hidden over a single viewport.
    if (layout && _.isArray(layout.viewports)) {
      return layout.viewports.length;
    }

    return _.keys(viewports).length;
  };

  // The editor takes over the whole viewport, so it is only offered for a single Cornerstone
  // viewport displaying a segmentation.
  const showSegEditorLaunchButton = () => !isSegEditor() && isCornerstone()
    && Object.keys(state.segmentData).length > 0 && getDisplayedViewportCount() === 1;


  // Build the data structure expected by SegmentationTable from cornerstone-tools state.
  // This is derived on every render so the table stays in sync with refreshSegmentations().
  const segTableData = selectedSegmentationOption && Object.keys(state.segmentData).length > 0
    ? [{
        segmentation: {
          segmentationId: selectedSegmentationOption.uid,
          label: selectedSegmentationOption.title ?? 'Segmentation',
          cachedStats: { info: '' },
          segments: state.segmentData,
        },
        representation: {
          active: true,
          visible: Object.values(state.segmentData).some((s) => s.visible),
          type: 'Labelmap',
          segments: state.segmentData,
          styles: {
            fillAlpha:         state.displayConfig.fillAlpha,
            fillAlphaInactive: state.displayConfig.fillAlphaInactive,
            outlineWidth:      state.displayConfig.outlineWidth,
            renderFill:        state.displayConfig.renderFill,
            renderOutline:     state.displayConfig.renderOutline,
          },
        },
      }]
    : [];

  // Toggle all-segments visibility via SegmentationTable's header eye icon.
  // Derives the target state from the current segmentData rather than the flat
  // segmentsHidden array so it works correctly with overlapping labelmaps.
  const onToggleSegmentationVisibility = (_segmentationId, _segType) => {
    const anyVisible = Object.values(state.segmentData).some((s) => s.visible);
    onVisibilityChangeHandler(!anyVisible);
  };

  if (state.showSettings) {
    return (
      <SegmentationSettings
        disabledFields={isVTK() ? disabledConfigurationFields : []}
        configuration={configuration}
        onBack={() => setState((state) => ({ ...state, showSettings: false }))}
        onChange={updateConfiguration}
        servicesManager={servicesManager}
      />
    );
  } else {
    return (
      <div className={classNames('dcmseg-segmentation-panel', {
          disabled: state.isDisabled,
        })}
      >

        {!isSegEditor() && isCornerstone() && Object.keys(state.segmentData).length > 0 && selectedSegmentationOption && (<>
        <section className={panelStyles.theme} ref={setPortalContainer}>
          <div className={panelStyles.panelWrapper}>
            <TooltipProvider>
              <SegmentationTable title='Segmentations' mode='expanded' portalContainer={portalContainer} 
                data={segTableData} disableEditing={true} showAddSegment={false} showInactiveSegmentationControls={false}
                onToggleSegmentationRepresentationVisibility={onToggleSegmentationVisibility}
                onSegmentClick={(segId, segIdx) => setCurrentSelectedSegment(segIdx, segId)}
                onToggleSegmentVisibility={panelOnToggleSegmentVisibility}
                showInactiveSegmentationControls={true} renderInactiveSegmentations={state.displayConfig.shouldRenderInactiveLabelmaps}
                    toggleRenderInactiveSegmentations={() => panelUpdateConfig({ shouldRenderInactiveLabelmaps: !state.displayConfig.shouldRenderInactiveLabelmaps })}
                  renderFill={state.displayConfig.renderFill} setRenderFill={({ type }, value) => panelUpdateConfig({ renderFill: value })}
                  renderOutline={state.displayConfig.renderOutline} setRenderOutline={({ type }, value) => panelUpdateConfig({ renderOutline: value })}
                  renderFillInactive={state.displayConfig.renderFillInactive} setRenderFillInactive={({ type }, value) => panelUpdateConfig({ renderFillInactive: value })}
                  renderOutlineInactive={state.displayConfig.renderOutlineInactive} setRenderOutlineInactive={({ type }, value) => panelUpdateConfig({ renderOutlineInactive: value })}
                  fillAlpha={state.displayConfig.fillAlpha} setFillAlpha={({ type }, value) => panelUpdateConfig({ fillAlpha: value })}
                  fillAlphaInactive={state.displayConfig.fillAlphaInactive} setFillAlphaInactive={({ type }, value) => panelUpdateConfig({ fillAlphaInactive: value })}
                  outlineWidth={state.displayConfig.outlineWidth} setOutlineWidth={({ type }, value) => panelUpdateConfig({ outlineWidth: value })}
              >

                <SegmentationTable.Config />

                <SegmentationTable.Expanded>


                  {!_.isNil(selectedSegmentationOption) && (<>
                    <div className="panelSelect">
                      <CustomSelect value={selectedSegmentationOption} options={state.labelMapList} />
                    </div>

                    <div className={panelStyles.panelHeader}>
                      <SonadorSegmentationHeader portalContainer={portalContainer} dropdownMenuContent={(<>
                          <DropdownMenuContent container={portalContainer} className="seg-dropdown-content">
                            {showSegEditorLaunchButton() && (<DropdownMenuItem onClick={() => onShowSegmentationEditor()} >
                              <Icons.Rename className="text-foreground" />
                              <span className="pl-2" data-cy="Edit Segmentation">{t('Edit Segmentation')}</span>
                            </DropdownMenuItem>)}
                            <DropdownMenuItem onClick={() => setState((state) => ({ ...state, showSettings: true }))}>
                              <Icons.GearSettings className='text-foreground' />
                              <span className='pl-2'>{t('Advanced Settings')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </>)} />
                    </div>
                  </>)}

                  <div className={panelStyles.panelExpandedContainer}>
                    <SegmentationTable.Expanded.Content>
                      <div className={panelStyles.panelActions}>
                        <SegmentationTable.AddSegmentRow />
                      </div>
                      <div className={panelStyles.panelSegments}>
                        <SegmentationTable.Segments />
                      </div>
                    </SegmentationTable.Expanded.Content>
                  </div>
                </SegmentationTable.Expanded>

              </SegmentationTable>
            </TooltipProvider>
          </div>
        </section>
        </>)}

        {isSegEditor() && (
          <SonadorSegmentationEditorPanel displaySetInstanceUID={getActiveViewport().displaySetInstanceUID} 
            commandsManager={commandsManager} servicesManager={servicesManager} />
        )}

        {isViewerVol3d() && (
          <SonadorVolumeViewerPanel displaySetInstanceUID={getActiveViewport().displaySetInstanceUID}
            commandsManager={commandsManager} servicesManager={servicesManager} />
        )}

        {isVTK() && (
          <SonadorMprSegmentationPanel displaySetInstanceUID={getActiveViewport().displaySetInstanceUID}
            commandsManager={commandsManager} servicesManager={servicesManager} />
        )}

        {isViewerM3d() && (
          <M3DViewerSidebarPanel displaySetInstanceUID={getActiveViewport().displaySetInstanceUID}
            commandsManager={commandsManager} servicesManager={servicesManager} />
        )}

      </div>
    );
  }
};


SegmentationPanel.propTypes = {
  /*
   * An object, with int index keys?
   * Maps to: state.viewports.viewportSpecificData, in `viewer`
   * Passed in MODULE_TYPES.PANEL when specifying component in viewer
   */
  viewports: PropTypes.shape({
    displaySetInstanceUID: PropTypes.string,
    frameRate: PropTypes.any,
    InstanceNumber: PropTypes.number,
    isMultiFrame: PropTypes.bool,
    isReconstructable: PropTypes.bool,
    Modality: PropTypes.string,
    plugin: PropTypes.string,
    SeriesDate: PropTypes.string,
    SeriesDescription: PropTypes.string,
    SeriesInstanceUID: PropTypes.string,
    SeriesNumber: PropTypes.any,
    SeriesTime: PropTypes.string,
    sopClassUIDs: PropTypes.arrayOf(PropTypes.string),
    StudyInstanceUID: PropTypes.string,
  }),
  /*
   * Maps to: state.viewports.layout, in `viewer`. The authoritative count of displayed
   * viewports; viewportSpecificData may still hold entries from a previous layout.
   */
  layout: PropTypes.shape({
    viewports: PropTypes.array,
  }),
  activeIndex: PropTypes.number.isRequired,
  studies: PropTypes.array.isRequired,
  isOpen: PropTypes.bool.isRequired,
};

/**
 * Returns SEG DisplaySets that reference the target series, sorted by dateTime
 *
 * @param {string} StudyInstanceUID
 * @param {string} SeriesInstanceUID
 * @returns Array
 */
const _getReferencedSegDisplaysets = (StudyInstanceUID, SeriesInstanceUID) => {
  /* Referenced DisplaySets */
  const studyMetadata = studyMetadataManager.get(StudyInstanceUID);
  const referencedDisplaysets = studyMetadata.getDerivedDatasets({
    referencedSeriesInstanceUID: SeriesInstanceUID,
    Modality: 'SEG',
  });

  /* Sort */
  referencedDisplaysets.sort((a, b) => {
    const aNumber = Number(`${a.SeriesDate}${a.SeriesTime}`);
    const bNumber = Number(`${b.SeriesDate}${b.SeriesTime}`);
    return bNumber - aNumber;
  });

  return referencedDisplaysets;
};

export default SegmentationPanel;
