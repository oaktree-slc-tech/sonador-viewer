/* global cornerstone */
import React, { createRef, useEffect, useState } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { utils } from '@ohif/core';

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
  let cancelablePromise;

  if (propsError) {
    loadingOrError = <ViewportErrorIndicator />;
  } else if (isLoading) {
    loadingOrError = <ViewportLoadingIndicator />;
  }

  const showStackLoadingProgressBar = showProgressBar && stackPercentComplete !== undefined;

  const shouldRenderToCanvas = imageId && !imageSrc;

  const fetchImagePromise = () => {
    if (!cancelablePromise) {
      return;
    }

    setLoading(true);
    cancelablePromise
      .then((response) => {
        setImage(response);
      })
      .catch((error) => {
        if (error.isCanceled) return;
        // setLoading(false);
        // setError(true);
        // throw new Error(error);
      });
  };

  const setImagePromise = () => {
    if (shouldRenderToCanvas) {
      cancelablePromise = utils.makeCancelable(cornerstone.loadAndCacheImage(imageId));
    }
  };

  const purgeCancelablePromise = () => {
    if (cancelablePromise) {
      cancelablePromise.cancel();
    }
  };

  useEffect(() => {
    return () => {
      purgeCancelablePromise();
    };
  }, [purgeCancelablePromise]);

  useEffect(() => {
    if (image.imageId) {
      cornerstone.renderToCanvas(canvasRef.current, image);
      setLoading(false);
    }
  }, [canvasRef, image, image.imageId]);

  useEffect(() => {
    if (!image.imageId || image.imageId !== imageId) {
      purgeCancelablePromise();
      setImagePromise();
      fetchImagePromise();
    }
  }, [fetchImagePromise, image.imageId, imageId, purgeCancelablePromise, setImagePromise]);

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
