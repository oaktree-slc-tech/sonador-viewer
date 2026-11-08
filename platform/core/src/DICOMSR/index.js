import isToolSupported from './utils/isToolSupported';
import { retrieveMeasurements, storeMeasurements } from './dataExchange';
import Enums from '../measurements/enums';
import { Enums as SREnums } from './enums';
import { clearHydratedReports, resolvePersonObserverName } from './utils/srDocument';
import srDisplayAnnotations from './readOnly/srDisplayAnnotations';

import Cornerstone from './SCOORD3D';
import Cornerstone3D from './Cornerstone3d';


const DICOMSR = {
  retrieveMeasurements,
  storeMeasurements,
  isToolSupported,
  resolvePersonObserverName,
  clearHydratedReports,
  // Read-only measurements in the Cornerstone3D viewports (the vtk extension's DICOMSRDisplay tool)
  srDisplayAnnotations,
  Enums,
  SREnums
};


export default DICOMSR;
