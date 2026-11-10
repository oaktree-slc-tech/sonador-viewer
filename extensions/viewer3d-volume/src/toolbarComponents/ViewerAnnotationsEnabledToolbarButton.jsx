import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import { Enums as c3dToolsEnums } from '@cornerstonejs/tools';

import OHIF from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';

// The Cornerstone3D events that change which session-only annotations there are, or their visibility
const ANNOTATION_EVENTS = ['ANNOTATION_COMPLETED', 'ANNOTATION_REMOVED', 'ANNOTATION_VISIBILITY_CHANGE'];


/** Whether any annotation is shown: true unless there are annotations and all are hidden */
function annotationsShown() {
  const measurementApi = OHIF.measurements.MeasurementApi.Instance;
  return !measurementApi?.areAllMeasurementsHidden();
}

function ViewerAnnotationsEnabledToolbarButton({ toolbarClickCallback, button }) {
  // Toolbar button (View -> Annotations) which follows the global annotation visibility: active
  // unless every annotation is hidden. It updates with the measurement service, with the
  // measurements the API publishes to the store (the read-only representations only it holds), and
  // with the Cornerstone3D annotation events (the views' session-only annotations).

  const { id, label, icon } = button;
  const storeMeasurements = useSelector(state => state.timepointManager?.measurements);
  const [isActive, setActive] = useState(annotationsShown);

  useEffect(() => {
    setActive(annotationsShown());
  }, [storeMeasurements]);

  useEffect(() => {
    const measurementService = OHIF.measurements.MeasurementApi.Instance?.measurementService;
    if (!measurementService) {
      return undefined;
    }
    const { MEASUREMENT_ADDED, RAW_MEASUREMENT_ADDED, MEASUREMENT_UPDATED, MEASUREMENT_REMOVED, MEASUREMENTS_CLEARED } =
      measurementService.EVENTS;
    const subscriptions = [MEASUREMENT_ADDED, RAW_MEASUREMENT_ADDED, MEASUREMENT_UPDATED, MEASUREMENT_REMOVED, MEASUREMENTS_CLEARED]
      .filter(Boolean)
      .map(event => measurementService.subscribe(event, () => setActive(annotationsShown())));
    return () => subscriptions.forEach(subscription => subscription?.unsubscribe());
  }, []);

  useEffect(() => {
    const update = () => setActive(annotationsShown());
    const events = ANNOTATION_EVENTS.map(name => c3dToolsEnums.Events[name]).filter(Boolean);
    events.forEach(event => c3dEventTarget.addEventListener(event, update));
    return () => events.forEach(event => c3dEventTarget.removeEventListener(event, update));
  }, []);

  return (
    <ToolbarButton
      key={id}
      id={id}
      label={label}
      icon={icon}
      onClick={(evt) => toolbarClickCallback(button, evt)}
      isActive={isActive}
      isToggle
    />
  );
}

ViewerAnnotationsEnabledToolbarButton.propTypes = {
  toolbarClickCallback: PropTypes.func.isRequired,
  button: PropTypes.object.isRequired,
};


export default ViewerAnnotationsEnabledToolbarButton;
