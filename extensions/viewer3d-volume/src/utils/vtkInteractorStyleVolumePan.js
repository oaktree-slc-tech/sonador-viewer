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

function vtkInteractorStyleVolumePan(publicAPI, model) {
  // VTK interactor style that can be used to move a volume within a window

  // Set classname
  model.classHierarchy.push('vtkInteractorStyleVolumePan');

  model.panManipulator = vtkMouseCameraTrackballPanManipulator.newInstance({});

  function setManipulators() {
    publicAPI.removeAllMouseManipulators();
    publicAPI.addMouseManipulator(model.panManipulator);
  }

  publicAPI.handleMousePan = (renderer, position) => {
    // Pan the camera as a result of mouse interaction
    if (!model.previousPosition) {
      return;
    }

    const camera = renderer.getActiveCamera();

    // Calculate the focal depth since we'll be using it a lot
    let viewFocus = camera.getFocalPoint();
    viewFocus = publicAPI.computeWorldToDisplay(
      renderer,
      viewFocus[0],
      viewFocus[1],
      viewFocus[2]
    );
    const focalDepth = viewFocus[2];

    const newPickPoint = publicAPI.computeDisplayToWorld(
      renderer,
      position.x,
      position.y,
      focalDepth
    );

    // Has to recalc old mouse point since the viewport has moved,
    // so can't move it outside the loop
    const oldPickPoint = publicAPI.computeDisplayToWorld(
      renderer,
      model.previousPosition.x,
      model.previousPosition.y,
      focalDepth
    );

    // Camera motion is reversed
    const motionVector = [];
    motionVector[0] = oldPickPoint[0] - newPickPoint[0];
    motionVector[1] = oldPickPoint[1] - newPickPoint[1];
    motionVector[2] = oldPickPoint[2] - newPickPoint[2];

    viewFocus = camera.getFocalPoint();
    const viewPoint = camera.getPosition();
    camera.setFocalPoint(
      motionVector[0] + viewFocus[0],
      motionVector[1] + viewFocus[1],
      motionVector[2] + viewFocus[2]
    );

    camera.setPosition(
      motionVector[0] + viewPoint[0],
      motionVector[1] + viewPoint[1],
      motionVector[2] + viewPoint[2]
    );
  };

  publicAPI.handleLeftButtonPress = (callData) => {
    // Begin pan event event
    publicAPI.startPan();
  };

  const superHandleMouseMove = publicAPI.handleMouseMove;
  publicAPI.handleMouseMove = (callData) => {
    // Move camera
    if (superHandleMouseMove) {
      superHandleMouseMove(callData);
    }

    if (model.state == States.IS_PAN) {
      publicAPI.handleMousePan(callData.pokedRenderer, callData.position);
      publicAPI.invokeInteractionEvent({ type: 'InteractionEvent' });
    }

    model.previousPosition = callData.position;
  };

  const superHandleLeftButtonRelease = publicAPI.handleLeftButtonRelease;
  publicAPI.handleLeftButtonRelease = () => {
    // end pan event
    switch (model.state) {
      case States.IS_PAN:
        publicAPI.endPan();
        break;

      default:
        if (superHandleLeftButtonRelease) {
          superHandleLeftButtonRelease();
        }
        break;
    }
  };

  setManipulators();
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  // Create style interactor inheritance tree
  vtkUtils.vtkInteractorStyleVolumeBase.extend(publicAPI, model, initialValues);

  // Initialize object specific methods
  vtkInteractorStyleVolumePan(publicAPI, model, initialValues);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkInteractorStyleVolumePan'
);

export default Object.assign({ newInstance, extend });
