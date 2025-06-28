// Manages Redux and other internal state for OHIF / Sonador DICOM-SR.

import cornerstone from 'cornerstone-core';

const state = {
  TrackingUniqueIdentifier: null,
  trackingIdentifiersByEnabledElementUUID: {},
};


function setTrackingUniqueIdentifiersForElement(element, trackingUniqueIdentifiers, activeIndex = 0) {
  // Set the tracking identifiers for provided element

  try {

    // Ensure that there is an active element before attempting to set tracking identifiers. 
    // Fixes issues when entering the Cornerstone context from other contexts such as VTK or Cornerstone3D viewports.
    const enabledElement = cornerstone.getEnabledElement(element);
    const { uuid } = enabledElement;

    state.trackingIdentifiersByEnabledElementUUID[uuid] = { trackingUniqueIdentifiers, activeIndex, };

  } catch(err) {
    console.error('Unable to set tracking identifiers for element due to an error. ', err, 
      element, trackingUniqueIdentifiers, activeIndex);
  }
}
  

function setActiveTrackingUniqueIdentifierForElement(element, TrackingUniqueIdentifier) {
  // Set the tracking identifiers for the providee element

  try {
    const enabledElement = cornerstone.getEnabledElement(element);
    const { uuid } = enabledElement;

    // Retrieve tracking identifiers based on the UUID of the enabled element
    const trackingIdentifiersForElement =
      state.trackingIdentifiersByEnabledElementUUID[uuid];

    if (trackingIdentifiersForElement) {
      const activeIndex = trackingIdentifiersForElement.trackingUniqueIdentifiers.findIndex(
        tuid => tuid === TrackingUniqueIdentifier
      );

      trackingIdentifiersForElement.activeIndex = activeIndex;
    }
  } catch(err) {
    console.error('Unable to set active the provided tracking unique identifier', element, TrackingUniqueIdentifier);
  }
}


function getTrackingUniqueIdentifiersForElement(element) {
  // Get the tracking unique identifier for the provided element

  const enabledElement = cornerstone.getEnabledElement(element);
  const { uuid } = enabledElement;

  if (state.trackingIdentifiersByEnabledElementUUID[uuid]) {
    return state.trackingIdentifiersByEnabledElementUUID[uuid];
  }

  return { trackingUniqueIdentifiers: [] };
}


export default {
  state,
  getters: {
    trackingUniqueIdentifiersForElement: getTrackingUniqueIdentifiersForElement,
  },
  setters: {
    trackingUniqueIdentifiersForElement: setTrackingUniqueIdentifiersForElement,
    activeTrackingUniqueIdentifierForElement: setActiveTrackingUniqueIdentifierForElement,
  },
};
