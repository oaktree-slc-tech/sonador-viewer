import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import './LoadingIndicator.css';

const LoadingIndicator = ({ loadingMessage = 'Loading ...', percentComplete = 0, error = null, }) => {
  // Sonador Viewer 3D Loading Indicator

  const { t } = useTranslation('Common');

  let percComplete = '';

  if (percentComplete && percentComplete !== 100) {
    percComplete = `${percentComplete}%`;
  }

  return (
    <>
      {error ? (
        <div className="imageViewerErrorLoadingIndicator loadingIndicator">
          <div className="indicatorContents">
            <h4>Error Loading Image</h4>
            <p className="description">An error has occurred.</p>
            <p className="details">{error.message}</p>
          </div>
        </div>
      ) : (
        <div className="imageViewerLoadingIndicator loadingIndicator">
          <div className="indicatorContents">
            <p>
              {t(loadingMessage)}
              <i className="fa fa-spin fa-circle-o-notch fa-fw" />
              {percComplete}
            </p>
          </div>
        </div>
      )}
    </>
  );
};


LoadingIndicator.propTypes = {
  percentComplete: PropTypes.number,
  error: PropTypes.object,
  loadingMessage: PropTypes.string,
};



export default LoadingIndicator;
