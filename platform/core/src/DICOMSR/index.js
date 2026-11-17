import isToolSupported from './utils/isToolSupported';
import { retrieveMeasurements, storeMeasurements } from './dataExchange';
import Enums from '../measurements/enums';
import { Enums as SREnums } from './enums';
import { clearHydratedReports, isApplicationMeasurement, resolvePersonObserverName } from './utils/srDocument';
import srDisplayAnnotations from './readOnly/srDisplayAnnotations';
import * as angleGeometry from './utils/angleGeometry';
import * as arrowGeometry from './utils/arrowGeometry';
import * as bidirectionalGeometry from './utils/bidirectionalGeometry';
import * as circleGeometry from './utils/circleGeometry';
import * as drawingPlane from './utils/drawingPlane';
import * as measurementView from './utils/measurementView';
import * as outOfPlane from './utils/outOfPlane';
import { saveResultSummary } from './utils/saveResult';
import landmarks from './landmarks';

import Cornerstone from './SCOORD3D';
import Cornerstone3D from './Cornerstone3d';


const DICOMSR = {
  retrieveMeasurements,
  storeMeasurements,
  isToolSupported,
  resolvePersonObserverName,
  clearHydratedReports,
  // Whether a measurement was read from an application document: shown read-only, never saved
  isApplicationMeasurement,
  // Read-only measurements in the Cornerstone3D viewports (the vtk extension's DICOMSRDisplay tool)
  srDisplayAnnotations,
  // Angle and Cobb angle encoding and value (the cornerstone extension's tools and mappings)
  angleGeometry,
  arrowGeometry,
  bidirectionalGeometry,
  circleGeometry,
  // Out-of-plane measurements: the record, the drawing volumes, the Drawing-Plane and the View
  outOfPlane,
  drawingPlane,
  measurementView,
  saveResultSummary,
  // Landmark sets read from the loaded documents: listed in the Annotations panel, never saved
  landmarks,
  Enums,
  SREnums
};


export default DICOMSR;
