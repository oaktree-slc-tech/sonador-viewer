import React from 'react';
import PropTypes from 'prop-types';

import { Icon } from './../elements/Icon';

export default function PlayClipButton({ isPlaying = false }) {
  const iconName = isPlaying ? 'stop' : 'play';
  return (
    <div className="btn-group">
      <button
        id="playClip"
        type="button"
        className="imageViewerCommand btn btn-sm btn-default"
        data-container="body"
        data-toggle="tooltip"
        data-placement="bottom"
        title="Play/Stop Clip"
      >
        <Icon name={iconName} />
      </button>
      <button
        id="toggleCineDialog"
        type="button"
        className="imageViewerCommand btn btn-sm btn-default"
        data-container="body"
        data-toggle="tooltip"
        data-placement="bottom"
        title="Toggle CINE Dialog"
      >
        <Icon name="youtube" />
      </button>
    </div>
  );
}

PlayClipButton.propTypes = {
  isPlaying: PropTypes.bool.isRequired,
};
