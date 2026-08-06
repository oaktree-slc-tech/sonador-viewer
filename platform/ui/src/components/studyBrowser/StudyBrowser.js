import React from 'react';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';

import { Thumbnail } from './Thumbnail';

import './StudyBrowser.styl';

function StudyBrowser({
  studies = [],
  onThumbnailClick = () => {},
  supportsDrag = true,
  showThumbnailProgressBar = true,
  renderSeriesActions,
}) {
  // View sidepanel / study browser

  return (
    <div className="study-browser">
      <div className="scrollable-study-thumbnails">
        {studies
          .map((study, studyIndex) => {
            const { StudyInstanceUID } = study;
            return study.thumbnails.map((thumb, thumbIndex) => {
              // TODO: Thumb has more props than we care about?
              const {
                active,
                altImageText,
                displaySetInstanceUID,
                imageId,
                derivedDisplaySetsNumber,
                numImageFrames,
                SeriesInstanceUID,
                SeriesDescription,
                SeriesNumber,
                hasWarnings,
                hasDerivedDisplaySets,
              } = thumb;

              return (
                <div key={thumb.displaySetInstanceUID} className="thumbnail-container" data-cy="thumbnail-list">
                  <Thumbnail
                    active={active}
                    supportsDrag={supportsDrag}
                    key={`${studyIndex}_${thumbIndex}`}
                    id={`${studyIndex}_${thumbIndex}`} // Unused?
                    
                    // Study
                    StudyInstanceUID={StudyInstanceUID} // used by drop

                    // Series metadata
                    SeriesInstanceUID={SeriesInstanceUID}
                    SeriesDescription={SeriesDescription}
                    SeriesNumber={SeriesNumber}
                    
                    // Thumb
                    altImageText={altImageText}
                    imageId={imageId}
                    derivedDisplaySetsNumber={derivedDisplaySetsNumber}
                    displaySetInstanceUID={displaySetInstanceUID} // used by drop
                    numImageFrames={numImageFrames}
                    hasWarnings={hasWarnings}
                    hasDerivedDisplaySets={hasDerivedDisplaySets}
                    
                    // Optional per-series actions menu, rendered at the far right of the footer.
                    // Only the viewer's ConnectedStudyBrowser supplies this; everything else that
                    // renders a Thumbnail passes nothing and shows no menu.
                    seriesActions={
                      renderSeriesActions
                        ? renderSeriesActions({
                            StudyInstanceUID,
                            SeriesInstanceUID,
                            SeriesNumber,
                            SeriesDescription,
                            displaySetInstanceUID,
                            numImageFrames,
                          })
                        : undefined
                    }

                    // Events
                    onClick={onThumbnailClick.bind(undefined, displaySetInstanceUID)}
                    showProgressBar={showThumbnailProgressBar}
                  />
                </div>
              );
            });
          })
          .flat()}
      </div>
    </div>
  );
}

StudyBrowser.propTypes = {
  studies: PropTypes.arrayOf(
    PropTypes.shape({
      StudyInstanceUID: PropTypes.string.isRequired,
      thumbnails: PropTypes.arrayOf(
        PropTypes.shape({
          altImageText: PropTypes.string,
          displaySetInstanceUID: PropTypes.string.isRequired,
          imageId: PropTypes.string,
          derivedDisplaySetsNumber: PropTypes.number,
          numImageFrames: PropTypes.number,
          SeriesDescription: PropTypes.string,
          SeriesNumber: PropTypes.number,
          stackPercentComplete: PropTypes.number,
        })
      ),
    })
  ).isRequired,
  supportsDrag: PropTypes.bool,
  onThumbnailClick: PropTypes.func,
  showThumbnailProgressBar: PropTypes.bool,
  /**
   Optional slot renderer for per-series actions, called with the series identifiers and expected
   to return a node (or null). Left undefined, no thumbnail renders a menu -- which is how this
   stays a viewer-only affordance.
   */
  renderSeriesActions: PropTypes.func,
};

export { StudyBrowser };
