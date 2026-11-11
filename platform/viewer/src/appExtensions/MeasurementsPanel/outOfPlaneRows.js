// Measurements panel rows of out-of-plane measurements (Length, Angle and Cobb angle held in the
// patient domain, DICOMSR utils/outOfPlane.js), and navigation to them. The row is the ordinary
// measurement row, marked as shown in the MPR and 3D views only, with the measurement's view in
// place of its image. A pending one is listed with the pending measurements, a saved one with the
// saved measurements, locked.
//
// Selecting one in the MPR view turns the pane nearest its plane onto it and moves the panes to
// its centroid; points in no common plane are centred on without turning a pane. The MPR view's
// series must share the measurement's Frame of Reference. The classic viewport cannot draw it: its
// row offers to open the MPR of a series of its Frame of Reference (its source series first), which
// then navigates the same way. A measurement whose Frame of Reference matches no loaded series
// offers no navigation.

import _ from 'lodash';

import OHIF, { DicomMetadataStore } from '@ohif/core';
import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';

import { isMprActive } from './mprMeasurementNavigation.js';

const measurementApiClass = () => OHIF.measurements.MeasurementApi;
const outOfPlane = () => OHIF.DICOMSR.outOfPlane;
const drawingPlanes = () => OHIF.DICOMSR.drawingPlane;

const capitalised = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');


/** The out-of-plane measurement-service records the panel lists */
function outOfPlaneMeasurements() {
  const api = measurementApiClass().Instance;
  const service = api && api.measurementService;
  return service ? service.getMeasurements().filter(m => outOfPlane().isOutOfPlaneMeasurement(m) && m.metadata.isListed !== false) : [];
}

/**
 * The panel row of an out-of-plane record.
 *
 * @param {object} measurement - the record
 * @param {object} tool - its tool configuration (the measurements table display function)
 * @param {object} options - { label, inClassicViewport }
 */
function outOfPlaneTableItem(measurement, tool, { label, inClassicViewport }) {
  const MeasurementApi = measurementApiClass();
  const metadata = measurement.metadata || {};
  const { isLocked, isReadOnly, isDirty, isVisible } = MeasurementApi._unpackMeasurementLifecycleAttrs(measurement);
  const { displayFunction } = tool.options.measurementTable;
  const series = outOfPlane().seriesOfFrameOfReference(measurement.FrameOfReferenceUID || metadata.FrameOfReferenceUID, DicomMetadataStore);
  const view = _.first(metadata.views);
  // Points in no common plane are drawn in the 3D views only: no slice contains them
  const planar = drawingPlanes().navigationPlaneOf(measurement.points || [], metadata.drawingPlane).kind !== 'none';
  return {
    toolType: measurement.toolName,
    trackingIdentifier: MeasurementApi.trackingIdentifierOf(measurement),
    measurementId: measurement.uid,
    _measurementServiceId: measurement.uid,
    label,
    description: measurement.description || metadata.description,
    location: metadata.location || measurement.location,
    isReadOnly: Boolean(isReadOnly),
    isLocked: Boolean(isLocked || isReadOnly),
    isPending: !isReadOnly,
    customColor: MeasurementApi.customLineTextColor(measurement),
    isDirty,
    isVisible: _.isNil(isVisible) ? true : isVisible,
    data: [{ displayText: displayFunction(measurement) || '...' }],
    refStudyInstanceUID: measurement.referenceStudyUID,
    refSeriesInstanceUID: metadata.sourceSeries || measurement.referenceSeriesUID,
    outOfPlane: {
      view: capitalised(view),
      viewName: view || '',
      frameOfReferenceLoaded: series.length > 0,
      inClassicViewport: Boolean(inClassicViewport),
      planar,
    },
  };
}

/** The panel rows of the out-of-plane measurements, pending and saved (read-only) */
function outOfPlaneRows(tools, { labelOf, viewports }) {
  const inClassicViewport = !isMprActive(viewports);
  const rows = { saved: [], pending: [] };
  outOfPlaneMeasurements().forEach((measurement) => {
    const tool = tools.find(candidate => candidate.id === measurement.toolName);
    if (!tool) {
      return;
    }
    const row = outOfPlaneTableItem(measurement, tool, { label: labelOf(measurement), inClassicViewport });
    (row.isReadOnly ? rows.saved : rows.pending).push({ row, toolGroup: tool.toolGroup });
  });
  return rows;
}


/** The record of a panel row of an out-of-plane measurement, or undefined */
function outOfPlaneRecordOf(measurementData) {
  if (!measurementData || !measurementData.outOfPlane) {
    return undefined;
  }
  const api = measurementApiClass().Instance;
  const record = api && api.measurementService.getMeasurement(measurementData._measurementServiceId || measurementData.measurementId);
  return outOfPlane().isOutOfPlaneMeasurement(record) ? record : undefined;
}

/** The Frame of Reference of a loaded series (its first instance that names one), or undefined */
function frameOfReferenceOfSeries(StudyInstanceUID, SeriesInstanceUID) {
  let series;
  try {
    series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
  } catch (error) {
    series = undefined;
  }
  const instance = ((series && series.instances) || []).find(candidate => candidate && candidate.FrameOfReferenceUID);
  return instance && instance.FrameOfReferenceUID;
}

const frameOfReferenceOf = record => record && (record.FrameOfReferenceUID || (record.metadata && record.metadata.FrameOfReferenceUID));

/** Where to navigate for a record: { worldPoint, viewPlaneNormal }; no normal for points in no common plane */
function navigationTargetOf(record) {
  const plane = record && drawingPlanes().navigationPlaneOf(record.points, record.metadata.drawingPlane);
  if (!plane) {
    return undefined;
  }
  return { worldPoint: plane.centroid, viewPlaneNormal: plane.kind === 'none' ? undefined : plane.normal };
}

/**
 * Navigate to an out-of-plane measurement in the open MPR view. Returns 'shown', or 'unavailable'
 * when it cannot be (no MPR view, no loaded series of its Frame of Reference).
 */
function navigateToOutOfPlane({ measurementData, viewportsState, commandsManager }) {
  const record = outOfPlaneRecordOf(measurementData);
  const target = navigationTargetOf(record);
  if (!target || !measurementData.outOfPlane.frameOfReferenceLoaded || !isMprActive(viewportsState)) {
    return 'unavailable';
  }
  // The MPR view shows a series of the measurement's Frame of Reference, or nothing of it is there
  const shown = (viewportsState.viewportSpecificData || {})[viewportsState.activeViewportIndex || 0] || {};
  if (frameOfReferenceOfSeries(shown.StudyInstanceUID, shown.SeriesInstanceUID) !== frameOfReferenceOf(record)) {
    return 'unavailable';
  }
  const jump = commandsManager.runCommand('jumpToMprWorldPoint', { ...target, anyAngle: true });
  return jump && jump.panes ? 'shown' : 'unavailable';
}

/**
 * Open the MPR view of the measurement's source series (or another loaded series of its Frame of
 * Reference) and navigate to it there. Resolves the outcome.
 */
async function openOutOfPlaneInMpr({ measurementData, commandsManager, studyMetadataManager }) {
  const record = outOfPlaneRecordOf(measurementData);
  const target = navigationTargetOf(record);
  if (!target) {
    return 'unavailable';
  }
  // The series of its Frame of Reference, its source series first when it is one of them
  const metadata = record.metadata || {};
  const sourceSeries = metadata.sourceSeries || record.referenceSeriesUID;
  const candidates = _.sortBy(
    outOfPlane().seriesOfFrameOfReference(frameOfReferenceOf(record), DicomMetadataStore),
    series => (series.SeriesInstanceUID === sourceSeries ? 0 : 1));
  const displaySet = candidates.map(({ StudyInstanceUID, SeriesInstanceUID }) => {
    const study = StudyInstanceUID && studyMetadataManager.get(StudyInstanceUID);
    return study && study.findDisplaySet(candidate => candidate.SeriesInstanceUID === SeriesInstanceUID);
  }).find(Boolean);
  if (!displaySet) {
    return 'unavailable';
  }
  // As the toolbar's 2D MPR button does: the layout button is hidden until the MPR view is exited
  useLayoutButton.getState().setIsDisplayedLayoutButton(false);
  const jump = await commandsManager.runCommand('openMprAtWorldPoint', { displaySet, ...target, anyAngle: true });
  return jump && jump.panes ? 'shown' : 'unavailable';
}


export {
  navigateToOutOfPlane, navigationTargetOf, openOutOfPlaneInMpr, outOfPlaneMeasurements, outOfPlaneRecordOf, outOfPlaneRows,
  outOfPlaneTableItem,
};
