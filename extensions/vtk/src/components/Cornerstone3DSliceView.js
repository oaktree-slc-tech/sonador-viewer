import _ from "lodash";

import React from "react";
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { eventTypes as uiEvents } from '@ohif/ui';

import vtkEnums, { MPR } from '../enums';
import { initCornerstone3d,  } from '../utils/cornerstone3d';
import Cornerstone3DLabelmapBaseView from './Cornerstone3DLabelmapBaseView.js';

const { DisplaySetApi } = OHIF.display;


class Cornerstone3DSliceView extends Cornerstone3DLabelmapBaseView{
  // VTK viewport which can be used to load and render a slice as part of an MPR view.
  // As part of the initialization cycle of the view, it checks to determine if an element
  // has been loaded.

  static id = 'Cornerstone3DSliceView';

  constructor(props) {
    super(props);
    console.log('[Cornerstone3DSliceView:init] props', props);
  }

  state = {
    ...Cornerstone3DLabelmapBaseView.state,
    imgSyncInit: false,
  }

  static defaultProps = {
    ... _.omit(Cornerstone3DLabelmapBaseView.defaultProps, 'renderId'),
    renderId: MPR.VTK_MPRSLICE_RENDER_ID,
    toolGroupId:  MPR.VTK_MPRSLICE_TOOLGROUP_ID,
    voiSyncId: MPR.VTK_MPRSLICE_VOI_SYNC_ID,
  }

  getViewportId() {
    // Retrieve the viewport ID for the instance

    const { renderId, sep, orientation} = this.props;
    return renderId+sep+orientation;
  }

  _evtDisplaySetApi({ apiEvent, uiEvent, ...apiData }) {
    // Manage displaySetApi events
    const component = this;
    const { eventTimeout } = component.props;

    const { displaySet: _ds } = component.props.viewportData;

    if (apiEvent == OHIF.display.Enums.EVENTS.UI && uiEvent == uiEvents.sidebar.toggle && component.renderEngine) {

      setTimeout(() => {
        // Resize and render viewports after sidebar toggle event changes display size

        component.renderEngine.resize();
        component.renderEngine.render();
      }, eventTimeout);

    } else if (apiEvent == vtkEnums.MPR.EVENTS.VTK_MPR_REFRESH_VIEWPORT && apiData.displaySetInstanceUID == _ds.displaySetInstanceUID) {

      // Re-render canvas
      setTimeout(() => { component.render3d(); }, eventTimeout);

    } else if (apiEvent == vtkEnums.MPR.EVENTS.VTK_MPR_ACTIVATE_TOOL && apiData.displaySetInstanceUID == _ds.displaySetInstanceUID) {

      // Update toolMode state
      component.setState({ toolMode: apiData.tool });
    }
  }

  initTools() {
    // Initialize tools for the viewport
    const component = this;
    const { commandsManager, toolGroupId, } = component.props;
    
    commandsManager.runCommand('initMprTools', { toolGroupId, component, }, vtkEnums.VIEWPORT);
    super.initTools();
  }

  initImageSync() {
    const component = this;
    const { commandsManager, voiSyncId } = component.props;

    commandsManager.runCommand('initMprImageSync', { voiSyncId, component, }, vtkEnums.VIEWPORT);
    component.setState({ imgSyncInit: true });
  }

  async componentDidMount() {
    // Initialize 3D viewer attributes
    
    const component = this;

    // Subscribe to displaySetApi DataSync events
    component.displayset_apisync = DisplaySetApi.Instance.displaySetService.subscribe(
      DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_DATASYNC, 
      component._evtDisplaySetApi.bind(component));

    await initCornerstone3d();
    await super.componentDidMount();
  }

  async componentDidUpdate(prevProps, prevState) {
    // Process component updates
    
    const component = this;
    const { isLoaded } = component.props;
    const { imgRenderInit, imgToolsInit, imgSyncInit, segInit, segRenderInit, segRepUpdatePaused } = component.state;

    if (isLoaded && imgToolsInit && !imgSyncInit) {
      component.initImageSync();
    }

    await super.componentDidUpdate(prevProps, prevState);

    // 3D slice view is intended to be used in multi-frame layouts where the segmentation volume
    // may have been created by other viewports. This check provides a fallback where the segmentation image
    // volume can be loaded and rendered for multi-slice layouts.
    const { segVol } = component._segVol();
    if (isLoaded && imgRenderInit && !segInit && segVol) {
      component.setState({ segInit: true });
    }
  }

  async componentWillUnmount() {
    // Unsubscribe events prior to component unmount

    const component = this;
    await super.componentWillUnmount();

    // displaySet API events
    component.displayset_apisync?.unsubscribe();
  }
}


Cornerstone3DSliceView.propTypes = {
  ...Cornerstone3DLabelmapBaseView.propTypes,
  toolGroupId: PropTypes.string,
  servicesManager: PropTypes.object.isRequired,
  commandsManager: PropTypes.object.isRequired,
};


export default Cornerstone3DSliceView;