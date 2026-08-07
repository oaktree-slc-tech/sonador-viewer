import React, { useCallback, useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';

import OHIF, { useViewportRef, display } from '@ohif/core';

import './OHIFCornerstonePdfViewport.css';


function OHIFCornerstonePdfViewport({
  viewportData,
  viewportId = 'pdf-viewport',
  viewportIndex,
  activeViewportIndex,
  isActive = true,
  setViewportActive,
  ...props
}) {
  // OHIF viewport which is able to render PDF files

  // Retrieve OHIF v3 compatible displaysets from the displaySetService
  const { displaySet } = viewportData;
  const displaySetService = display.DisplaySetApi.Instance.displaySetService;
  const displaySets = displaySetService.getDisplaySetsForSeries(displaySet.SeriesInstanceUID);

  const [url, setUrl] = useState(null);
  const viewportElementRef = useRef(null);
  const viewportRef = useViewportRef(viewportId);

  const onInteractionStart = useCallback(() => {
    // Claim the viewer focus for this viewport (if it is not already active). Mirrors the
    // interaction handling of the other viewport types (M3D, segmentation editor, ECG, VTK),
    // which is what allows the toolbar, side panels, and viewport highlight to follow the
    // document the user is working with in a multi-viewport layout.

    if (viewportIndex !== activeViewportIndex && typeof setViewportActive === 'function') {
      setViewportActive();
    }
  }, [viewportIndex, activeViewportIndex, setViewportActive]);

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

  // Click-to-focus gate for the embedded document.
  //
  // The PDF is drawn by the browser's own document viewer inside the <object>, which is a
  // separate browsing context: every pointer and keyboard event raised over it is consumed
  // there and none of it -- not a click, not a focus change, not a window blur -- is reported
  // back to the embedding page. There is therefore no event this viewport could listen for to
  // learn that the user is working in the document, so an inactive viewport instead suppresses
  // pointer events on the <object> and lets the container take the first click. That click
  // claims the viewer focus and hands the document back its input, which is the same
  // click-to-activate contract the image viewports follow. The mechanism (and the CSS classes)
  // is the one already used to turn the viewport into a drag-and-drop target.
  const documentClassName = isActive ? style : 'pdf-no-click';

  return (
    <div
      className="bg-primary-black h-full w-full text-white"
      onPointerDown={onInteractionStart}
      onFocus={onInteractionStart}
      onClick={() => {
        onInteractionStart();
        makePdfScrollable();
      }}
      ref={el => {
        viewportElementRef.current = el;
        if (el) viewportRef.register(el);
      }}
      data-viewport-id={viewportId}
    >
      <object
        data={url}
        type="application/pdf"
        className={documentClassName}
      >
        <div>No online PDF viewer installed</div>
      </object>
    </div>
  );
}


OHIFCornerstonePdfViewport.propTypes = {
  viewportId: PropTypes.string,
  viewportIndex: PropTypes.number,
  activeViewportIndex: PropTypes.number,
  isActive: PropTypes.bool,
  setViewportActive: PropTypes.func,
};


export default OHIFCornerstonePdfViewport;