import React from 'react';
import PropTypes from 'prop-types';

import { Thumbnail } from '../studyBrowser';

import './SeriesList.styl';

export function SeriesList({ seriesItems, onClick, activeDisplaySetInstanceUID }) {
  return (
    <div className="study-browser-series clearfix thumbnails-wrapper">
      <div className="study-series-container">
        {seriesItems.map((seriesData, index) => {
          return (
            <Thumbnail
              key={seriesData.displaySetInstanceUID}
              id={`series_thumb_${index}`}
              {...seriesData}
              active={seriesData.displaySetInstanceUID === activeDisplaySetInstanceUID}
              onClick={() => onClick(seriesData)}
            />
          );
        })}
      </div>
    </div>
  );
}

SeriesList.propTypes = {
  seriesItems: PropTypes.array.isRequired,
  onClick: PropTypes.func.isRequired,
  activeDisplaySetInstanceUID: PropTypes.string,
};
