/* global cornerstone */
import React, { createRef, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { utils } from '@ohif/core';
import loadThumbnailImage from '@ohif/core/src/utils/loadThumbnailImage.js';

import ViewportErrorIndicator from '../../viewer/ViewportErrorIndicator';
import ViewportLoadingIndicator from '../../viewer/ViewportLoadingIndicator';

import './ImageThumbnail.styl';

// TODO: How should we have this component depend on Cornerstone?
// - Passed in as a prop?
// - Set as external dependency?
// - Pass in the entire load and render function as a prop?
//import cornerstone from 'cornerstone-core';
function ImageThumbnail({ active = false, width = 217, height = 123, imageSrc, imageId, stackPercentComplete = 0, error: propsError = false, showProgressBar = true }) {

  const [isLoading, setLoading] = useState(false);
  const [image, setImage] = useState({});
  const canvasRef = createRef();

  let loadingOrError;
  // The load in flight. Held in a ref, not a local, so re-renders of this component (the stack's
  // progress events alone cause many) neither cancel nor restart it: a preview served by the
  // archive-based loader can take seconds, and a load restarted on every render never finishes
  // (imaging-development-env#103).
  const cancelablePromise = useRef(null);

  if (propsError) {
    loadingOrError = <ViewportErrorIndicator />;
  } else if (isLoading) {
    loadingOrError = <ViewportLoadingIndicator />;
  }

  const showStackLoadingProgressBar = showProgressBar && stackPercentComplete !== undefined;

  const shouldRenderToCanvas = imageId && !imageSrc;

  const purgeCancelablePromise = () => {
    if (cancelablePromise.current) {
      cancelablePromise.current.cancel();
      cancelablePromise.current = null;
    }
  };

  const fetchImagePromise = () => {
    if (!shouldRenderToCanvas) {
      return;
    }
    const promise = utils.makeCancelable(loadThumbnailImage(imageId));
    cancelablePromise.current = promise;

    setLoading(true);
    promise
      .then((response) => {
        if (cancelablePromise.current === promise) {
          cancelablePromise.current = null;
        }
        setImage(response);
      })
      .catch((error) => {
        if (error.isCanceled) return;
        // A preview that cannot load leaves the indicator: the stack bar still reports the series
        setLoading(false);
      });
  };

  useEffect(() => {
    if (image.imageId) {
      cornerstone.renderToCanvas(canvasRef.current, image);
      setLoading(false);
    }
  }, [canvasRef, image, image.imageId]);

  // One load per imageId: started when the id is set or changes, cancelled when it changes again or
  // the thumbnail unmounts
  useEffect(() => {
    if (!image.imageId || image.imageId !== imageId) {
      purgeCancelablePromise();
      fetchImagePromise();
    }
    return () => {
      purgeCancelablePromise();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  return (
    <div className={classNames('ImageThumbnail', { active: active })}>
      <div className="image-thumbnail-canvas">
        {shouldRenderToCanvas ? (
          <canvas ref={canvasRef} width={width} height={height} />
        ) : (
          <img className="static-image" src={imageSrc} height={height} alt={''} />
        )}
      </div>
      {loadingOrError}
      {showStackLoadingProgressBar && (
        <div className="image-thumbnail-progress-bar">
          <div className="image-thumbnail-progress-bar-inner" style={{ width: `${stackPercentComplete}%` }} />
        </div>
      )}
      {isLoading && <div className="image-thumbnail-loading-indicator"></div>}
    </div>
  );
}


ImageThumbnail.propTypes = {
  active: PropTypes.bool,
  imageSrc: PropTypes.string,
  imageId: PropTypes.string,
  error: PropTypes.bool,
  width: PropTypes.number,
  height: PropTypes.number,
  stackPercentComplete: PropTypes.number.isRequired,
  showProgressBar: PropTypes.bool,
};



export default ImageThumbnail;
