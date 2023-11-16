import macro from '@kitware/vtk.js/macro';
import Constants from '@kitware/vtk.js/Rendering/Core/InteractorStyle/Constants';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';

const { States } = Constants;

function vtkInteractorStyleVolumeBase(publicAPI, model) {
  // VTK interactor style that can be used to interact with 3D VTK based volumes

  // Set classname
  model.classHierarchy.push('vtkInteractorStyleVolumeBase');

  // Core events
  model.trackballManipulator = vtkMouseRangeManipulator.newInstance({
    button: 1,
  });

  function setManipulators() {
    publicAPI.removeAllMouseManipulators();
    publicAPI.addMouseManipulator(model.trackballManipulator);
  }

  const superSetInteractor = publicAPI.setInteractor;
  publicAPI.setInteractor = (interactor) => {
    // Set the interactor for the style

    superSetInteractor(interactor);
  };

  publicAPI.setVolumeActor = (actor) => {
    // Add a reference for the volume actor
    model.volumeActor = actor;
    const renderer = model._interactor.getCurrentRenderer();
    const camera = renderer.getActiveCamera();
  };
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  // Crate style interactor inheritance tree
  vtkInteractorStyleManipulator.extend(publicAPI, model, initialValues);

  // Initialize object specific methods
  vtkInteractorStyleVolumeBase(publicAPI, model, initialValues);
}

export const newInstance = macro.newInstance(extend, 'vtkInteractorStyleVolumeBase');

export default Object.assign({ newInstance, extend });
