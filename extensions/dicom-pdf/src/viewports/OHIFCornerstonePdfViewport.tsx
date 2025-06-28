import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';

import OHIF, { useViewportRef, display } from '@ohif/core';

import './OHIFCornerstonePdfViewport.css';


function OHIFCornerstonePdfViewport({ viewportData, viewportId = 'pdf-viewport', ...props }) {
  // OHIF viewport which is able to render PDF files

  // Retrieve OHIF v3 compatible displaysets from the displaySetService
  const { displaySet } = viewportData;
  const displaySetService = display.DisplaySetApi.Instance.displaySetService;
  const displaySets = displaySetService.getDisplaySetsForSeries(displaySet.SeriesInstanceUID);  
  
  const [url, setUrl] = useState(null);
  const viewportElementRef = useRef(null);
  const viewportRef = useViewportRef(viewportId);

  useEffect(() => {
    document.body.addEventListener('drag', makePdfDropTarget);
    return function cleanup() {
      document.body.removeEventListener('drag', makePdfDropTarget);
      viewportRef.unregister();
    };
  }, []);

  const [style, setStyle] = useState('pdf-yes-click');

  const makePdfScrollable = () => {
    setStyle('pdf-yes-click');
  };

  const makePdfDropTarget = () => {
    setStyle('pdf-no-click');
  };

  if (displaySets && displaySets.length > 1) {
    throw new Error(
      'OHIFCornerstonePdfViewport: only one display set is supported for dicom pdf right now'
    );
  }

  const { renderedUrl } = displaySets[0];

  useEffect(() => {
    // Load PDF from displaySet, via renderedUrl attribute or via `fetchPdf` method

    const load = async () => {

      if (renderedUrl) { 

        // Await renderedUrl promise to fulfill
        setUrl(await renderedUrl);
      } else {

        throw new Error('Unable to load PDF from displaySet');
      }
    };

    load();
  }, [renderedUrl]);

  return (
    <div
      className="bg-primary-black h-full w-full text-white"
      onClick={makePdfScrollable}
      ref={el => {
        viewportElementRef.current = el;
        if (el) viewportRef.register(el);
      }}
      data-viewport-id={viewportId}
    >
      <object
        data={url}
        type="application/pdf"
        className={style}
      >
        <div>No online PDF viewer installed</div>
      </object>
    </div>
  );
}


OHIFCornerstonePdfViewport.propTypes = {
  viewportId: PropTypes.string,
};


export default OHIFCornerstonePdfViewport;