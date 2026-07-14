import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';

import Cornerstone3DSliceView from '../components/Cornerstone3DSliceView';

import '../VTKViewport.css';



const VTKViewport = ({ onScroll = () => {}, setViewportActive, viewportIndex, activeViewportIndex, ...props }) => {
  const style = { width: '100%', height: '100%', position: 'relative' };

  const setViewportActiveHandler = useCallback(() => {
    if (viewportIndex !== activeViewportIndex) {
      // set in Connected
      setViewportActive();
    }
  });

  useEffect(() => {
    const handleScrollEvent = (evt) => {
      const vtkViewportApiReference = onScroll(viewportIndex) || {};
      const viewportUID = vtkViewportApiReference.uid;
      const viewportWasScrolled = viewportUID === evt.detail.uid;

      if (viewportWasScrolled) {
        setViewportActiveHandler();
      }
    };

    window.addEventListener('vtkscrollevent', handleScrollEvent);
    return () => window.removeEventListener('vtkscrollevent', handleScrollEvent);
  }, [onScroll, viewportIndex, setViewportActiveHandler]);

  return (
    <div className="vtk-viewport-handler" style={style} onClick={setViewportActiveHandler}>
      <Cornerstone3DSliceView onScroll={onScroll} setViewportActive={setViewportActive}
        viewportIndex={viewportIndex} activeViewportIndex={activeViewportIndex} {...props} />
    </div>
  );
};



VTKViewport.propTypes = {
  setViewportActive: PropTypes.func.isRequired,
  viewportIndex: PropTypes.number.isRequired,
  activeViewportIndex: PropTypes.number.isRequired,

  /* Receives viewportIndex */
  onScroll: PropTypes.func,
};


export default VTKViewport;
