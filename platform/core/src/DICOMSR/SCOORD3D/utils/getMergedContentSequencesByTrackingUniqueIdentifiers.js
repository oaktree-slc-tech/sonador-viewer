import { CodeNameCodeSequenceValues } from '../../enums';
import { conceptNameValue } from '../../utils/codedConcept';

import getSequenceAsArray from './getSequenceAsArray';

const getMergedContentSequencesByTrackingUniqueIdentifiers = (MeasurementGroups) => {
  const mergedContentSequencesByTrackingUniqueIdentifiers = {};

  MeasurementGroups.forEach((MeasurementGroup) => {
    const ContentSequence = getSequenceAsArray(MeasurementGroup.ContentSequence);

    const TrackingUniqueIdentifierItem = ContentSequence.find(
      (item) => conceptNameValue(item) === CodeNameCodeSequenceValues.TrackingUniqueIdentifier
    );

    if (!TrackingUniqueIdentifierItem) {
      console.warn('No Tracking Unique Identifier, skipping ambiguous measurement.');
    }

    const trackingUniqueIdentifier = TrackingUniqueIdentifierItem.UID;

    if (mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] === undefined) {
      // Add the full ContentSequence
      mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] = [...ContentSequence];
    } else {
      // Add the ContentSequence minus the tracking identifier, as we have this
      // Information in the merged ContentSequence anyway.
      ContentSequence.forEach((item) => {
        if (conceptNameValue(item) !== CodeNameCodeSequenceValues.TrackingUniqueIdentifier) {
          mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier].push(item);
        }
      });
    }
  });

  return mergedContentSequencesByTrackingUniqueIdentifiers;
};

export default getMergedContentSequencesByTrackingUniqueIdentifiers;
