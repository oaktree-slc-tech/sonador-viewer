import { adaptersSR } from '@cornerstonejs/adapters';

import initDisplaySetMeasurements from './initDisplaySetMeasurements';
import parseDicomStructuredReport from './parseDicomStructuredReport';
import { MeasurementReport as Cornerstone3dMeasurementReport } from './MeasurementReport';
import { sonadorAdaptersSR as Cornerstone3DSrAdapters } from './adapters';


const Cornerstone3D = {
  initDisplaySetMeasurements,
  parseDicomStructuredReport,
  MeasurementReport: Cornerstone3dMeasurementReport,
  adaptersSR: Cornerstone3DSrAdapters,
}


const MeasurementReport = Cornerstone3dMeasurementReport;


export default Cornerstone3D;
export { Cornerstone3D, initDisplaySetMeasurements, parseDicomStructuredReport, MeasurementReport, Cornerstone3DSrAdapters }