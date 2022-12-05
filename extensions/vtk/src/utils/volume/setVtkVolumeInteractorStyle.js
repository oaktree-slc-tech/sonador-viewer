import _ from 'lodash';

const setVtkVolumeInteractorStyle = (api, istyle, callbacks = {}) => {
  // Apply interactor style to a VTK rendering window

  // @input api (VTK 3D API object): 3D API object from react-vtkjs-viewport
  // @Input istyle (VTK interactor style): interactor style to be applied to the VTK rendering window
  // @input callbacks (object): callbacks to be associated with the interactor

  // @returns object: event subscriptions and other object references
  let results = { subscriptions: [] };

  // Retrieve interactor reference from API
  const interactor = api.genericRenderWindow.getInteractor();
  if (_.isFunction(interactor.setInteractorStyle)) {
    interactor.setInteractorStyle(istyle);
  }

  // Assign interaction style to volumes
  if (
    api.volumes &&
    api.volumes.length &&
    _.isFunction(istyle.setVolumeActor)
  ) {
    istyle.setVolumeActor(api.volumes[0]);
  }

  // Apply callbacks to interaciton style
  _.each(callbacks, (v, k) => {
    if (_.isFunction(istyle[k])) {
      results.subscriptions.push(istyle[k](callbacks[k]));
    }
  });

  // Update window after assigning new style
  api.genericRenderWindow.getRenderWindow().render();

  return results;
};

export default setVtkVolumeInteractorStyle;
