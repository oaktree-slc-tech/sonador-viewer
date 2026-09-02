import React from 'react';
// DO not Remove cornerstone, without it can be broken
import cornerstone from 'cornerstone-core';
import cornerstoneTools from 'cornerstone-tools';

import {
  Enums as C3dEnums,
  cache as c3dCache,
  getRenderingEngine as c3dGetRenderingEngine,
} from "@cornerstonejs/core";

import { extractStudyIdFromURL } from '@ohif/core/src/utils/extractStudyIdFromURL';

import OHIF from '@ohif/core';
import { eventTypes as uiEvents, Icon } from '@ohif/ui';

import { eventTypes as segmentationEventTypes } from '@ohif/extension-dicom-segmentation';

import vtkEnums from './enums';
import Cornerstone3DSliceView from './components/Cornerstone3DSliceView';
import Cornerstone3DInspectionView from './components/Cornerstone3DInspectionView';
import LoadingIndicator from './components/LoadingIndicator.js';
import VolumeFitNotice, { getVolumeFitNoticeKey } from './components/VolumeFitNotice.js';
import OHIFVtkBaseViewport from './ohifComponents/OHIFVtkBaseViewport.js';
import ConnectedVTKViewport from './connectedComponents/ConnectedVTKViewport';
import { uiNotificationService } from '@ohif/core';

const segmentationModule = cornerstoneTools.getModule('segmentation');

const { DisplaySetApi } = OHIF.display;


class OHIFVTKMprViewport extends OHIFVtkBaseViewport {
  // OHIF VTK viewport used to retrieve images for the VTK MPR viewport.
  // Also manages interactions with the Cornerstone3D inspection ("details") view.

  static defaultProps = {
    onScroll: () => {},
    eventTimeout: 50,
  };

  static id = 'OHIFVTKViewport';

  state = {
    ...super.state,
    isInpsectionViewOpen: false,
  };

  setStateFromProps() {
    const component = this;

    const { eventTimeout } = this.props;
    const { studies, displaySet } = this.props.viewportData;
    const { StudyInstanceUID, displaySetInstanceUID, sopClassUIDs, SOPInstanceUID, frameIndex } = displaySet;

    if (sopClassUIDs.length > 1) {
      console.warn('More than one SOPClassUID in the same series is not yet supported.');
    }

    const study = studies.find((study) => study.StudyInstanceUID === StudyInstanceUID);

    const dataDetails = {
      studyDate: study.studyDate,
      studyTime: study.studyTime,
      studyDescription: study.studyDescription,
      patientName: study.patientName,
      patientId: study.patientId,
      seriesNumber: String(displaySet.seriesNumber),
      seriesDescription: displaySet.seriesDescription,
    };

    try {

      // Retrieve the display set's imageIds and its legacy labelmap. The Cornerstone3D view builds
      // and streams the volume from these; nothing is decoded here.
      const { imageIds, labelmapDataObject, labelmapColorLUT, labelmapDetails } = this.getViewportData(
        studies, StudyInstanceUID, displaySetInstanceUID, SOPInstanceUID, frameIndex);

      component.hasError = false;

      component.setState(
        {
          percentComplete: 0,
          loadProgress: null,
          loadError: null,
          fit: null,
          dataDetails,
        },
        () => {
          setTimeout(() => {

            const { displaySet } = component.props.viewportData;
            const { displaySetInstanceUID } = displaySet;
            const { labelmapInstanceUID, labelmapMetadata } = labelmapDetails;

            // Pull displaySet dataset from service to ensure that it is up to date.
            const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
            if (_ds) {

              // Mark the viewport as stable to prevent unintended reload
              _ds.stableViewport = true;
              _ds.segmentationId = labelmapInstanceUID;              
              DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
            }

            component.setState({
              imageIds,
              paintFilterLabelMapImageData: labelmapDataObject,
              paintFilterLabelMapDetails: labelmapDetails,
              labelmapColorLUT,
              // The viewport is handed to the view as soon as the imageIds are known: it enables
              // the element and calls setVolumes immediately, and planes appear as slices arrive.
              isLoaded: true,
            });
          }, eventTimeout);
        }
      );
    } catch (error) {
      // Resolving the stack failed, so there is nothing to render at all. Reported through the
      // same one-per-volume path as a load failure.
      console.error('Failed to load image data.', error);
      component.onLoadError(error);
      this.setState({ isLoaded: true });
    }
  }

  notifyLoadError(error) {
    // The MPR viewport's toast carries the way out of the layout: the message tells the user
    // which viewer to switch to, not just that the load failed.

    uiNotificationService.show({
      title: 'Failed to load image data.',
      message: error.message,
      type: 'error',
      autoClose: false,
      studyInstanceUID: extractStudyIdFromURL(),
      error,
      action: {
        label: 'Exit 2D MPR',
        onClick: ({ close }) => {
          close();
          this.props.commandsManager.runCommand('setCornerstoneLayout');
        },
      },
    });
  }

  resizeViewport() {
    if (this.api && this.api.genericRenderWindow) {
      this.api.genericRenderWindow.resize();
    }
  }

  componentDidMount() {
    // Initialize component
    this.boundResizeViewport = this.resizeViewport.bind(this);

    // Subscribe to VTK tab events in order update component after UI changes
    document.addEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.addEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    // Load images to VTK.js viewport
    this.setStateFromProps();
  }

  componentDidUpdate(prevProps, prevState) {
    // Update component after change
    const component = this;

    const { eventTimeout } = this.props;
    const { displaySet } = this.props.viewportData;
    const prevDisplaySet = prevProps.viewportData.displaySet;
    const { isInpsectionViewOpen } = component.state;

    if (
      displaySet.displaySetInstanceUID !== prevDisplaySet.displaySetInstanceUID ||
      displaySet.SOPInstanceUID !== prevDisplaySet.SOPInstanceUID ||
      displaySet.frameIndex !== prevDisplaySet.frameIndex
    ) {
      this.setStateFromProps();
    }

    if (prevState.isInpsectionViewOpen && !isInpsectionViewOpen) {

      setTimeout(() => {
        DisplaySetApi.Instance.displaySetService.triggerApiEvent(vtkEnums.MPR.EVENTS.VTK_MPR_REFRESH_VIEWPORT, {
          displaySetInstanceUID: displaySet.displaySetInstanceUID,
        });
      }, eventTimeout);
      
      console.log('[OHIFVTKViewport:component-updated] isnpection view closed, refresh', displaySet.displaySetInstanceUID);
    }
  }

  componentWillUnmount() {
    // Remove event handlers and reactive logic for viewport
    const component = this;
    const { eventTimeout } = component.props;

    // Unsubscribe from VTK tab events
    document.removeEventListener(segmentationEventTypes.SegmentationPanelTabUpdatedEvent, this.boundResizeViewport);
    document.removeEventListener(uiEvents.sidebar.toggle, this.boundResizeViewport);

    setTimeout(() => {
      const { displaySet } = component.props.viewportData;
      const { displaySetInstanceUID } = displaySet;

      if (displaySetInstanceUID) {        

        // Pull displaySet data from service to ensure that it is up to date. The displaySet data
        // on the props hash may have been mutated and will not have an accurate state of the volume viewer.
        const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        if (_ds && _ds.stableViewport) {

          // Clear segmentationId from displaySet
          _ds.segmentationId = undefined;
          _ds.stableViewport = false;

          DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
        }
      }
    }, eventTimeout);
  }

  _getOrientation() {
    // Retrieve the orientation of the current viewport
    const component = this;
    
    let _o;
    if (component.props.viewportIndex == 1) {
      _o = C3dEnums.OrientationAxis.SAGITTAL;
    } else if (component.props.viewportIndex == 2) {
      _o = C3dEnums.OrientationAxis.CORONAL
    } else {
      _o = C3dEnums.OrientationAxis.AXIAL;
    }

    return _o;
  }

  render() {
    const component = this;
    const { configuration: segmentationConfiguration } = segmentationModule;
    const { UIModalService } = this.props.servicesManager.services;
    
    let childrenWithProps = null;

    const handleToggleInspectionView = () => {
      // Display Cornerstone 3D tools inspection view for the volume
      
      const { viewportData, servicesManager } = component.props;
      const { 
        isInpsectionViewOpen, isLoaded, imageIds,
        paintFilterLabelMapImageData, paintFilterLabelMapDetails
      } = component.state;
      const { displaySet } = component.props.viewportData;
      const { SeriesDescription, SeriesInstanceUID, displaySetInstanceUID } = displaySet;

      component.setState((prevState) => ({
        isInpsectionViewOpen: !prevState.isInpsectionViewOpen,
      }));

      // Display detail view in modal
      const WrappedSeriesInspectionView = function() {
        return (
          <Cornerstone3DInspectionView
            viewportData={viewportData} isLoaded={isLoaded} imageIds={imageIds}
            onClose={() => component.setState({ isInpsectionViewOpen: false })}
            servicesManager={servicesManager} orientation={component._getOrientation()}
            paintFilterLabelMapImageData={paintFilterLabelMapImageData}
            paintFilterLabelMapDetails={paintFilterLabelMapDetails}
            labelmapRenderingOptions={{
              colorLUT: component.state.labelmapColorLUT,
              globalOpacity: segmentationConfiguration.fillAlpha,
              visible: segmentationConfiguration.renderFill,
              outlineThickness: segmentationConfiguration.outlineWidth,
              renderOutline: segmentationConfiguration.renderOutline,
              segmentsDefaultProperties: component.segmentsDefaultProperties,
              onNewSegmentationRequested: () => {
                component.setStateFromProps();
              },
            }}            
          />
        );
      }

      UIModalService.show({
        content: WrappedSeriesInspectionView,
        title: SeriesDescription ? SeriesDescription : 'Details for Series '+(SeriesInstanceUID || displaySetInstanceUID),
        fullscreen: true,
        noScroll: true,
        onClose: () => {

          // Trigger the per-slice-view refresh event as an additional backup.
          DisplaySetApi.Instance.displaySetService.triggerApiEvent(vtkEnums.MPR.EVENTS.VTK_MPR_REFRESH_VIEWPORT, {
            displaySetInstanceUID: displaySet.displaySetInstanceUID,
          });

          // Indicate that inspection view is closed
          component.setState({ isInpsectionViewOpen: false });
        },
      });
    };

    // TODO: Does it make more sense to use Context?
    if (component.props.children && component.props.children.length) {
      childrenWithProps = component.props.children.map((child, index) => {
        return (
          child &&
          React.cloneElement(child, {
            viewportIndex: component.props.viewportIndex,
            key: index,
          })
        );
      });
    }

    const style = { width: '100%', height: '100%', position: 'relative' };

    // The indicator clears when the volume finishes streaming, not when the stack resolves: the
    // planes are already on screen and filling in before that.
    const loadComplete = !!component.state.loadProgress?.complete;

    return (
      <>
        <div style={style}>
          {!loadComplete && (
            <LoadingIndicator
              percentComplete={component.state.percentComplete}
              loadProgress={component.state.loadProgress}
            />
          )}
          <VolumeFitNotice fit={component.state.fit} />
          {component.state.imageIds && (
            <ConnectedVTKViewport 
              servicesManager={component.props.servicesManager} commandsManager={component.props.commandsManager}
              isLoaded={component.state.isLoaded}
              viewportData={component.props.viewportData} imageIds={component.state.imageIds}
              paintFilterLabelMapImageData={component.state.paintFilterLabelMapImageData}
              paintFilterLabelMapDetails={component.state.paintFilterLabelMapDetails}
              onLoadProgress={component.onLoadProgress}
              onLoadError={component.onLoadError}
              onVolumeFit={component.onVolumeFit}
              viewportIndex={component.props.viewportIndex} 
              orientation={component._getOrientation()}
              dataDetails={component.state.dataDetails}
              labelmapRenderingOptions={{
                colorLUT: component.state.labelmapColorLUT,
                globalOpacity: segmentationConfiguration.fillAlpha,
                visible: segmentationConfiguration.renderFill,
                outlineThickness: segmentationConfiguration.outlineWidth,
                renderOutline: segmentationConfiguration.renderOutline,
                segmentsDefaultProperties: component.segmentsDefaultProperties,
                onNewSegmentationRequested: () => {
                  component.setStateFromProps();
                },
              }}
              onScroll={component.props.onScroll}
              afterCreation={(api) => (component.api = api)}
            />
          )}
        </div>
        {component.state.imageIds && (
          <div className="zoomButton" onClick={handleToggleInspectionView} >
            <Icon name="search-plus" width="18px" height="18px" />
          </div>
        )}
        {childrenWithProps}
      </>
    );
  }
}


export default OHIFVTKMprViewport;
