import macro from '@kitware/vtk.js/macro';
import Constants from '@kitware/vtk.js/Rendering/Core/InteractorStyle/Constants';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';

import { vtkUtils } from '@ohif/extension-vtk';

const { States } = Constants;

function vtkInteractorStyleVolumeWindowLevel(publicAPI, model) {
  // VTK interactor style that can be used to modify window levels for an image volume

  // Set classname
  model.classHierarchy.push('vtkInteractorStyleVolumeWindowLevel');

  publicAPI.getWindowLevel = () => {
    // Retrieve the current window level

    if (model.volumeActor) {
      return vtkUtils.getWindowLevel(model.volumeActor);
    }

    throw new Error('Unable to retrieve window level, invalid volume actor');
  };

  publicAPI.setWindowLevel = (windowWidth, windowCenter) => {
    // Set window levels and apply to volume

    if (model.volumeActor) {
      // Calculate high/low range from the window width and center and cache
      const lhrange = vtkUtils.toLowHighRange(windowWidth, windowCenter);
      model.levels.windowWidth = windowWidth;
      model.levels.windowCenter = windowCenter;

      // Apply to volume
      model.volumeActor
        .getProperty()
        .getRGBTransferFunction(0)
        .setMappingRange(lhrange.lower, lhrange.upper);
    } else {
      throw new Error('Unable to set window level, invalid volume actor');
    }
  };

  publicAPI.windowLevelFromMouse = (pos) => {
    // Retrieve the window levels from the mouse position

    if (model.volumeActor) {
      // Retrieve the current image intensity range
      const range = model.volumeActor
        .getMapper()
        .getInputData()
        .getPointData()
        .getScalars()
        .getRange();

      // Convert to dynamic x and y
      const imageDynamicRange = range[1] - range[0];
      const multiplier =
        Math.round(imageDynamicRange / 1024) * publicAPI.getLevelScale();
      const dx = Math.round((pos[0] - model.wlStartPos[0]) * multiplier);
      const dy = Math.round((pos[1] - model.wlStartPos[1]) * multiplier);

      let windowWidth = model.levels.windowWidth + dx;
      let windowCenter = model.levels.windowCenter - dy;
      windowWidth = Math.max(0.01, windowWidth);

      // Check for a change in the window center or width
      if (
        model.windowWidth == windowWidth &&
        model.windowCenter == windowCenter
      ) {
        return;
      }

      // Set new window center and width
      publicAPI.setWindowLevel(windowWidth, windowCenter);
      model.wlStartPos[0] = Math.round(pos[0]);
      model.wlStartPos[1] = Math.round(pos[1]);

      // Trigger callbacks
      const onLevelsChanged = publicAPI.getOnLevelsChanged();
      if (onLevelsChanged) {
        onLevelsChanged({ windowCenter, windowWidth });
      }
    }
  };

  const superHandleLeftButtonPress = publicAPI.handleLeftButtonPress;
  publicAPI.handleLeftButtonPress = (callData) => {
    // Begin window level changes

    // Determine where the start/stop position for the tracking should be
    model.wlStartPos[0] = callData.position.x;
    model.wlStartPos[1] = callData.position.y;

    if (!callData.shiftKey && !callData.controlKey && model.volumeActor) {
      // Retrieve volume properties and calculate range
      const property = model.volumeActor.getProperty();
      if (property) {
        model.initialMRange = property
          .getRGBTransferFunction(0)
          .getMappingRange()
          .slice();

        model.levels = vtkUtils.toWindowLevel(
          model.initialMRange[0],
          model.initialMRange[1]
        );

        // Start window leveling
        publicAPI.startWindowLevel();
      }
    } else if (superHandleLeftButtonPress) {
      superHandleLeftButtonPress(callData);
    }
  };

  const superHandleMouseMove = publicAPI.handleMouseMove;
  publicAPI.handleMouseMove = (callData) => {
    // Handle mouse movement events, if part of a Window level event then adjust the
    // volume window distribution.

    if (model.state == States.IS_WINDOW_LEVEL) {
      const pos = [callData.position.x, callData.position.y];
      publicAPI.windowLevelFromMouse(pos);
    }

    if (superHandleMouseMove) {
      superHandleMouseMove(callData);
    }
  };

  const superHandleLeftButtonRelease = publicAPI.handleLeftButtonRelease;
  publicAPI.handleLeftButtonRelease = () => {
    // End window level changes

    switch (model.state) {
      case States.IS_WINDOW_LEVEL:
        publicAPI.endWindowLevel();
        break;

      default:
        if (superHandleLeftButtonRelease) {
          superHandleLeftButtonRelease();
        }
        break;
    }
  };
}

const DEFAULT_VALUES = {
  wlStartPos: [0, 0],
  levelScale: 1,
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Create style interactor inheritance tree
  vtkUtils.vtkInteractorStyleVolumeBase.extend(publicAPI, model, initialValues);

  // Add set/get methods for window levels
  macro.setGet(publicAPI, model, ['onLevelsChanged', 'levelScale']);

  // Initialize object specific methods
  vtkInteractorStyleVolumeWindowLevel(publicAPI, model, initialValues);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkInteractorStyleVolumeWindowLevel'
);

export default Object.assign({ newInstance, extend });
