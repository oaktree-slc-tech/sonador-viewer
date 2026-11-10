// The Annotations drawer's all-annotations visibility toggle, the same control as the
// Segmentations panel's all-segments toggle (ui-next SegmentationTable AddSegmentRow): the same
// icons, colours, placement at the right of a row above the list. The icon gives the state: the Hide
// icon while every annotation is shown, the Show icon (blue) while any is hidden. Clicking hides
// every annotation unless all are already hidden, then shows them all, in every view
// (MeasurementApi.setAllMeasurementsVisibility). While only some are hidden the label names both
// the state and the action, since the icon then marks the state, not the action.

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { Button, Icons } from '@ohif/ui-next';

import './VisibilityToggle.styl';

/** The table rows of the panel's measurement groups */
const rowsOf = measurementCollection => (measurementCollection || [])
  .flatMap(group => (group && group.measurements) || []);

/** Whether every annotation of the panel is shown */
function allAnnotationsVisible(measurementCollection) {
  return rowsOf(measurementCollection).every(row => row && row.isVisible !== false);
}

/** Whether every annotation of the panel is hidden */
function allAnnotationsHidden(measurementCollection) {
  return rowsOf(measurementCollection).every(row => row && row.isVisible === false);
}

function AnnotationsVisibilityRow({ measurementCollection, onToggleAllVisibility }) {
  const { t } = useTranslation('MeasurementTable');

  // No annotations, no toggle
  if (!rowsOf(measurementCollection).length) {
    return null;
  }

  const allVisible = allAnnotationsVisible(measurementCollection);
  const allHidden = allAnnotationsHidden(measurementCollection);
  const label = allHidden
    ? t('Show all annotations')
    : allVisible ? t('Hide all annotations') : t('Some annotations are hidden. Hide all annotations');

  return (
    <div className="measurementTableVisibilityRow">
      <Button
        size="icon"
        variant="ghost"
        className="annotationVisibilityToggle allAnnotations"
        data-cy="all-annotations-visibility-toggle"
        aria-label={label}
        title={label}
        onClick={() => onToggleAllVisibility(allHidden)}
      >
        {allVisible ? <Icons.Hide /> : <Icons.Show />}
      </Button>
    </div>
  );
}

AnnotationsVisibilityRow.propTypes = {
  measurementCollection: PropTypes.array,
  /** Called with the visibility to give every annotation */
  onToggleAllVisibility: PropTypes.func.isRequired,
};


export default AnnotationsVisibilityRow;
export { AnnotationsVisibilityRow, allAnnotationsVisible, allAnnotationsHidden };
