import React, { useContext } from 'react';
import { useSelector } from 'react-redux';

import { Enums as csextEnums } from '@ohif/extension-cornerstone';
import { Enums as vtkEnums } from '@ohif/extension-vtk';
import { Enums as vol3dViewerEnums } from '@ohif/extension-viewer3d-volume';
import { Enums as m3dEnums } from '@ohif/extension-viewerm3d';
import { Enums as SegEditEnums } from '@ohif/extension-seg3d-editor';

import { getActiveContexts } from '../store/layout/selectors.js';

let AppContext = React.createContext({});

export const CONTEXTS = {
  CORNERSTONE: csextEnums.ACTIVE_VIEWPORT,
  VTK: vtkEnums.ACTIVE_VIEWPORT,
  VIEWER3DVOL: vol3dViewerEnums.ACTIVE_VIEWPORT,
  SONADOR3DSEG: SegEditEnums.ACTIVE_VIEWPORT,
  M3D: m3dEnums.ACTIVE_VIEWPORT,
};


export const useAppContext = () => useContext(AppContext);


export const AppProvider = ({ children, config }) => {
  const activeContexts = useSelector(getActiveContexts);

  return <AppContext.Provider value={{ appConfig: config, activeContexts }}>{children}</AppContext.Provider>;
};


export const withAppContext = (Component) => {
  return function WrappedComponent(props) {
    const { appConfig, activeContexts } = useAppContext();
    return <Component {...props} appConfig={appConfig} activeContexts={activeContexts} />;
  };
};


export default AppContext;
