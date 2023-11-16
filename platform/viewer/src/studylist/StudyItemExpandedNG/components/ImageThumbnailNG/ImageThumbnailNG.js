import React, { useEffect, useRef } from 'react';
import classNames from 'classnames';
import cornerstone from 'cornerstone-core';
import PropTypes from 'prop-types';

import ViewportErrorIndicator from '@ohif/ui/src/viewer/ViewportErrorIndicator';
import ViewportLoadingIndicator from '@ohif/ui/src/viewer/ViewportLoadingIndicator';

import { useImageThumbnail } from './logic';

import styles from './ImageThumbnailNG.module.scss';

function ImageThumbnailNG({ width, height, imageSrc, imageId, error = false, onClick }) {
  const canvasRef = useRef();

  const { data, isLoading } = useImageThumbnail({ imageId, imageSrc });

  let loadingOrError;
  const thumbnail = data || {};

  if (error) {
    loadingOrError = <ViewportErrorIndicator />;
  } else if (isLoading) {
    loadingOrError = <ViewportLoadingIndicator />;
  }

  useEffect(() => {
    if (thumbnail.imageId) {
      cornerstone.renderToCanvas(canvasRef.current, thumbnail);
    }
  }, [thumbnail]);

  return (
    <div className={classNames(styles.container, { clickable: !!onClick })} onClick={() => onClick?.()}>
      <div className={styles.thumbnailWrapper}>
        {imageId && !imageSrc ? (
          <canvas ref={canvasRef} width={width} height={height} className={styles.canvas} />
        ) : (
          <img className={styles.staticImage} src={imageSrc} height={height} alt="static" />
        )}
      </div>
      {loadingOrError}
      {isLoading && <div className={styles.loading} />}
    </div>
  );
}

ImageThumbnailNG.propTypes = {
  imageSrc: PropTypes.string,
  imageId: PropTypes.string,
  error: PropTypes.bool,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  onClick: PropTypes.func,
};

export default ImageThumbnailNG;
