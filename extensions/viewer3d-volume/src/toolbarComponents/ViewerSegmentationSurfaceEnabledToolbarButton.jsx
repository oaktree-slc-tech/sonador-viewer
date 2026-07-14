import _ from 'lodash';
import React, { useRef } from 'react';
import { useSelector } from 'react-redux';

import OHIF, { redux } from '@ohif/core';
import { viewerbaseGetDisplaySet, } from '@ohif/ui';

import { DisplaySetAttributeActiveToolbarButton } from '@ohif/extension-vtk';

const { DisplaySetApi } = OHIF.display;


function ViewerSegmentationSurfaceEnabledToolbarButton({
    isActiveDisplaySetAttr = 'segmentationSurfaceEnabled', isVisibleDefault = false, isActiveDefault = false, ...props
  }) {
  // Toolbar button which toggles active or inactive depending on the state of the imageVolumeRenderingEnabled of the current displaySet.
  
  const { viewportSpecificData, activeViewportIndex } = useSelector(redux.selectors.getActiveViewportData);
  const { displaySet: _ds0 } = viewerbaseGetDisplaySet(viewportSpecificData, activeViewportIndex);

  // Toggle button visible based on whether the segmentationSurfaceEnabled property is present. Hide the button if the
  // displaySet property has not yet been defined.
  let isVisible = _.isNil(DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(_ds0.displaySetInstanceUID)?.[isActiveDisplaySetAttr])
    ? isVisibleDefault : true;

  return (<>
    {isVisible && (
      <DisplaySetAttributeActiveToolbarButton 
      isActiveDisplaySetAttr={isActiveDisplaySetAttr} isActiveDefault={isActiveDefault}
      {...props}
      />
    )}
  </>);
}


export default ViewerSegmentationSurfaceEnabledToolbarButton;