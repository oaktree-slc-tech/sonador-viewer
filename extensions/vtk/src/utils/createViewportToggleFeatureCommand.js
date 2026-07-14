import _ from 'lodash';

import OHIF from '@ohif/core';

const { DisplaySetApi } = OHIF.display;


export default function createViewportToggleFeatureCommand(propertyName) {
  // Create a command function to manage the state of a feature by toggling a displaySet variable.
  // The toggle only fires when the attribute is already non-nil, so the owning viewport must
  // initialize the attribute during load and clear it on unmount (see the
  // imageVolumeRenderingEnabled / segmentationSurfaceEnabled lifecycle in OHIFVtkVolumeViewport,
  // and the segEditor* attributes in OHIFSegmentationEditorViewport). State indicators track the
  // attribute through DisplaySetAttributeActiveToolbarButton.

  // @param propertyName: name of the displaySet attribute to toggle
  // @returns a command function that accepts ({ viewports }) as an input.

  return ({ viewports }) => {

    // Retrieve displaySet of active viewport
    const { activeViewportIndex, viewportSpecificData } = viewports;
    const viewportData = viewportSpecificData[activeViewportIndex];
    if (viewportData.displaySetInstanceUID) {

      // Retrieve display set and toggle the feature attribute
      const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(viewportData.displaySetInstanceUID);
      if (!_.isNil(_ds[propertyName])) {

        // Publish to displaySetService
        _ds[propertyName] = !_ds[propertyName];
        DisplaySetApi.Instance.displaySetService.addDisplaySets([_ds]);
      }
    }
  }
}
