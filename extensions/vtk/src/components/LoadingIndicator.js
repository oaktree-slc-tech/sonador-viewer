import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import './LoadingIndicator.css';

const LoadingIndicator = ({
  loadingMessage = 'Loading ...',
  percentComplete = 0,
  loadProgress = null,
  notice = null,
  error = null,
}) => {
  // Sonador Viewer 3D Loading Indicator.
  //
  // `loadProgress` is the Cornerstone3D streaming volume's `{ framesProcessed, numberOfFrames }`
  // and, when present, is shown as a slice count alongside the percentage.
  // `notice` is the pre-flight message for a reduced-resolution volume; it is rendered on
  // its own so it can stand without a spinner once loading is done.

  const { t } = useTranslation('Common');

  let percComplete = '';

  if (percentComplete && percentComplete !== 100) {
    percComplete = `${percentComplete}%`;
  }

  let sliceCount = '';
  if (loadProgress && loadProgress.numberOfFrames && !loadProgress.complete) {
    sliceCount = ` (${loadProgress.framesProcessed} / ${loadProgress.numberOfFrames})`;
  }

  return (
    <>
      {error ? (
        <div className="imageViewerErrorLoadingIndicator loadingIndicator">
          <div className="indicatorContents">
            <h4>Error Loading Image</h4>
            <p className="description">An error has occurred.</p>
            <p className="details">{error.message}</p>
            {notice && <p className="details">{notice}</p>}
          </div>
        </div>
      ) : (
        <div className="imageViewerLoadingIndicator loadingIndicator">
          <div className="indicatorContents">
            <p>
              {t(loadingMessage)}
              <i className="fa fa-spin fa-circle-o-notch fa-fw" />
              {percComplete}
              {sliceCount}
            </p>
            {notice && <p className="details">{notice}</p>}
          </div>
        </div>
      )}
    </>
  );
};


LoadingIndicator.propTypes = {
  percentComplete: PropTypes.number,
  loadProgress: PropTypes.object,
  notice: PropTypes.string,
  error: PropTypes.object,
  loadingMessage: PropTypes.string,
};



export default LoadingIndicator;
