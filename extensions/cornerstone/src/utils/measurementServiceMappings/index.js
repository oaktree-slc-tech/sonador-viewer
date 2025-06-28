// Compatibiltiy module which allows access to measurement mappings methods and data processing
// classes/methods for MeasurementService.


// Cornerstone Legacy/Classic Data Processing Tools
import {
	measurementServiceMappingsFactory as cornerstoneMeasurementServiceMappingsFactory
} from './Cornerstone/measurementServiceMappingsFactory.js';
import measurementMappingTools from './Cornerstone/common';
import Length from './Cornerstone/Length';

const cornerstoneMeasurementDataProc = {
	measurementServiceMappingsFactory: cornerstoneMeasurementServiceMappingsFactory,
	common: measurementMappingTools,
	Length,
}


// Cornerstone 3D Data processing tools
import {
	measurementServiceMappingsFactory as cornerstone3dMeasurementServiceMappingsFactory
} from './Cornerstone3d/measurementServiceMappingsFactory';
import { Length as c3dLength } from './Cornerstone3d/Length';


const cornerstone3dMeasurementDataProc = {
	measurementServiceMappingsFactory: cornerstone3dMeasurementServiceMappingsFactory,
	Length: c3dLength,
}


export default cornerstoneMeasurementServiceMappingsFactory;
export { cornerstoneMeasurementServiceMappingsFactory, cornerstoneMeasurementDataProc, cornerstone3dMeasurementDataProc, }