// ZoomTool subclass with configurable scroll-wheel speed.
// The base class hardcodes a canvas delta of `direction * 5` per wheel tick,
// which is too slow for 3D navigation. wheelSpeedMultiplier scales the
// synthetic drag distance before the base _zoom() logic runs.

// Configure via: toolGroup.addTool(SonadorZoomTool.toolName, { wheelSpeedMultiplier: 6 })

import {
  ToolGroupManager as C3dToolGroupManager,
  SynchronizerManager as C3dSynchronizerManager,

  // Viewport Tools
  WindowLevelTool as C3dWindowLevelTool,
  ZoomTool as C3dZoomTool,
  PanTool as C3dPanTool,
  StackScrollTool as C3dStackScrollTool,
  TrackballRotateTool as C3dTrackballRotateTool,
  Enums as c3dToolsEnums,
  addTool as c3dAddTool,

  // Annotation management
  annotation as c3dAnnotations,
  cancelActiveManipulations, 

  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';


class SonadorZoomTool extends C3dZoomTool {
  // Provides a Zoom Tool which is able to scroll faster than the default Cornerstone3D Zoom tool

  static toolName = 'SonadorZoomTool';
  
  constructor(toolProps = {}, defaultToolProps = {
    configuration: {
      wheelSpeedMultiplier: 4,
    },
  }) {
    super(toolProps, defaultToolProps);
  }
  
  mouseWheelCallback(evt) {
    const { wheelSpeedMultiplier } = this.configuration;
    const amplified = {
      ...evt,
      detail: {
        ...evt.detail,
        wheel: {
          ...evt.detail.wheel,
          direction: evt.detail.wheel.direction * wheelSpeedMultiplier,
        },
      },
    };
    this._zoom(amplified);
  }
}


export default SonadorZoomTool;