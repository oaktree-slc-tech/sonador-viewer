import React from 'react';
import PropTypes from 'prop-types';

import Cornerstone3DVolumeViewport from '../components/Cornerstone3DVolumeView';


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
      <Cornerstone3DVolumeViewport {...props} />
    </div>
  );
};


VTKVolumeViewport.propTypes = {
  setViewportActive: PropTypes.func.isRequired,
  viewportIndex: PropTypes.number.isRequired,
  activeViewportIndex: PropTypes.number.isRequired,
};


export default VTKVolumeViewport;
