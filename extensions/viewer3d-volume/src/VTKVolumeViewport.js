import React from 'react';
import { View3D } from '@sonador/react-vtkjs-viewport';
import PropTypes from 'prop-types';


const VTKVolumeViewport = (props) => {
  // React component that can be used to render volumes. (Uses VTK.js components.)

  const style = { width: '100%', height: '100%', position: 'relative' };

  const setViewportActiveHandler = () => {
    const { setViewportActive, viewportIndex, activeViewportIndex } = props;

    if (viewportIndex !== activeViewportIndex) {
      setViewportActive();
    }
  };

  return (
    <div className="vtk-view3d-handler" style={style} onClick={setViewportActiveHandler}>
      <View3D {...props} />
    </div>
  );
};


VTKVolumeViewport.propTypes = {
  setViewportActive: PropTypes.func.isRequired,
  viewportIndex: PropTypes.number.isRequired,
  activeViewportIndex: PropTypes.number.isRequired,
};


export default VTKVolumeViewport;
