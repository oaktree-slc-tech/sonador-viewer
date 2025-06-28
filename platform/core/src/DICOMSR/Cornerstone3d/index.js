import { adaptersSR } from '@cornerstonejs/adapters';

import initDisplaySetMeasurements from './initDisplaySetMeasurements';
import parseDicomStructuredReport from './parseDicomStructuredReport';
import { MeasurementReport as Cornerstone3dMeasurementReport } from './MeasurementReport';

const { Cornerstone3D: Cornerstone3DSrAdapters } = adaptersSR;


const Cornerstone3D = {
  initDisplaySetMeasurements,
  parseDicomStructuredReport,
  MeasurementReport: Cornerstone3dMeasurementReport,
}
const MeasurementReport = Cornerstone3dMeasurementReport;

export default Cornerstone3D;
export { Cornerstone3D, initDisplaySetMeasurements, parseDicomStructuredReport, MeasurementReport }