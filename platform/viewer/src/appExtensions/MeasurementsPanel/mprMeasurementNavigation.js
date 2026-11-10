// Measurements panel navigation while the MPR view is open. A measurement on the MPR view's series
// is brought into view in the MPR panes: the pane parallel to its plane moves to its slice and the
// other panes move through it (vtk extension `jumpToMprWorldPoint`). A measurement on another
// series, or one whose image plane is too far from every pane for it to be drawn there, needs the
// stack viewport: after the user confirms, the MPR view closes and the panel navigates to the
// measurement as it does outside MPR.

import OHIF from '@ohif/core';
import { metaData as c3dMetaData } from '@cornerstonejs/core';

// Read when used: the panel's modules load before the measurement API is configured
const measurementApiClass = () => OHIF.measurements.MeasurementApi;

const DIALOG = {
  id: 'mpr-measurement-navigation',
  title: 'Close MPR View?',
  message: 'This measurement is on another series. To show it, the MPR view closes and the viewer opens '
    + 'that series at the measurement.',
  confirmText: 'Show Measurement',
  cancelText: 'Cancel',
};

/** The confirmation for a measurement of the MPR series that no pane can draw */
const obliqueDialog = limitDegrees => ({
  ...DIALOG,
  message: `This measurement's image is tilted more than ${limitDegrees}° from the MPR views, so it cannot be `
    + 'drawn in them. To show it, the MPR view closes and the viewer opens the series at the measurement.',
});

/** Whether the active viewport is the MPR view */
function isMprActive(viewportsState) {
  const viewports = (viewportsState && viewportsState.layout && viewportsState.layout.viewports) || [];
  const active = viewports[(viewportsState && viewportsState.activeViewportIndex) || 0];
  return Boolean(active && active.vtk);
}

/** The panel row's measurement: its representation, or its measurement-service record */
function measurementOf(measurementData) {
  const api = measurementApiClass().Instance;
  const toolType = measurementApiClass()._getToolType(measurementData);
  const _id = measurementData.measurementId || measurementData._id;
  const representation = api && api.tools[toolType] && api.tools[toolType].find(m => m._id === _id);
  if (representation) {
    return representation;
  }
  return api && _id ? api.getServiceMeasurementByCornerstoneId(_id) : undefined;
}

function metadata(type, imageId) {
  try {
    return imageId ? c3dMetaData.get(type, imageId) : undefined;
  } catch (error) {
    return undefined;
  }
}

function imageIdOf(measurement) {
  return measurement ? measurementApiClass()._getImageIdentifiers(measurement).imageId : undefined;
}

/** The series a measurement is drawn on */
function seriesOf(measurement) {
  if (!measurement) {
    return undefined;
  }
  const series = measurementApiClass().seriesInstanceUIDOf(measurement);
  if (series) {
    return series;
  }
  const module = metadata('generalSeriesModule', imageIdOf(measurement));
  return module && module.seriesInstanceUID;
}

/**
 * The world (patient, mm) point to bring into view for a measurement: the centre of its handles
 * on its image, or the centre of the image when it has no handles; undefined without an image
 * plane.
 */
function worldTargetOf(measurement) {
  const { isPlane, imageToPatient } = OHIF.DICOMSR.angleGeometry;
  const module = metadata('imagePlaneModule', imageIdOf(measurement));
  if (!isPlane(module)) {
    return undefined;
  }
  const handles = (measurement && (measurement.handles || (measurement.measurementData && measurement.measurementData.handles)
    || (measurement.data && measurement.data.handles))) || {};
  const points = Object.keys(handles)
    .filter(name => name !== 'textBox' && handles[name] && Number.isFinite(handles[name].x) && Number.isFinite(handles[name].y))
    .map(name => [handles[name].x, handles[name].y]);
  const imagePoint = points.length
    ? [0, 1].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length)
    : [(Number(module.columns) || 0) / 2, (Number(module.rows) || 0) / 2];
  return imageToPatient(module, imagePoint);
}

/** The normal of the plane a measurement lies in (its image's), or undefined without a plane */
function planeNormalOf(measurement) {
  const module = metadata('imagePlaneModule', imageIdOf(measurement));
  if (!OHIF.DICOMSR.angleGeometry.isPlane(module)) {
    return undefined;
  }
  const [r, c] = [Array.from(module.rowCosines, Number), Array.from(module.columnCosines, Number)];
  return [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
}

/**
 * Navigate to a panel row's measurement while the MPR view is open.
 *
 * @param {object} params
 * @param {object} params.measurementData - the panel row
 * @param {object} params.viewportsState - the viewports state (redux)
 * @param {object} params.commandsManager
 * @param {Function} params.confirm - asks the user (callConfirmDialog's parameters); resolves true to proceed
 * @param {Function} params.navigateOutsideMpr - navigates to the measurement once the MPR view has closed
 * @returns {Promise<'shown'|'left'|'cancelled'|'unavailable'>} shown in the MPR panes, shown in the stack
 *   viewport after the MPR view closed, left in the MPR view by the user, or not navigable
 */
async function navigateToMeasurementInMpr({ measurementData, viewportsState, commandsManager, confirm, navigateOutsideMpr }) {
  const measurement = measurementOf(measurementData);
  const activeIndex = viewportsState.activeViewportIndex || 0;
  const mprDisplaySet = (viewportsState.viewportSpecificData || {})[activeIndex] || {};
  const series = seriesOf(measurement);

  let dialog = DIALOG;
  if (series && series === mprDisplaySet.SeriesInstanceUID) {
    const worldPoint = worldTargetOf(measurement);
    if (!worldPoint) {
      return 'unavailable';
    }
    // The pane closest to the measurement's plane turns onto it: an oblique acquisition's
    // measurement is drawn only in a pane parallel to it. Beyond the alignment limit no pane is,
    // and the panes are left as they were
    const jump = commandsManager.runCommand('jumpToMprWorldPoint', { worldPoint, viewPlaneNormal: planeNormalOf(measurement) });
    if (!jump || !jump.panes) {
      return 'unavailable';
    }
    if (jump.drawn) {
      return 'shown';
    }
    dialog = obliqueDialog(jump.limitDegrees);
  }

  const proceed = await confirm(dialog);
  if (!proceed) {
    return 'cancelled';
  }
  commandsManager.runCommand('setCornerstoneLayout');

  // The stack viewport mounts with the new layout before the panel navigates in it
  await new Promise(resolve => setTimeout(resolve, 0));
  navigateOutsideMpr();
  return 'left';
}


export default navigateToMeasurementInMpr;
export { DIALOG, isMprActive, obliqueDialog, measurementOf, navigateToMeasurementInMpr, planeNormalOf, seriesOf, worldTargetOf };
