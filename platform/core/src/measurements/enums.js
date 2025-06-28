// Cornerstone Tools SR Adapter Classes
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import { MeasurementReport as CornerstoneMeasurementReport } from '../DICOMSR/SCOORD3D/MeasurementReport';
import { MeasurementReport as Cornerstone3dMeasurementReport } from '../DICOMSR/Cornerstone3d/MeasurementReport';

import {
	EVENTS as SERVICE_EVENTS
} from '../services/MeasurementService/MeasurementService';

import { Enums as SREnums } from '../DICOMSR/enums';
const {
	CORNERSTONE_TOOLS_SOURCE_NAME,
	CORNERSTONE_TOOLS_SOURCE_VERSION,
	CORNERSTONE_3D_TOOLS_SOURCE_NAME,
	CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
} = SREnums;
const {
	SONADOR_PROJECT,
	SONADOR_VIEWER,
	SONADOR_MEASUREMENT_REPORT_SERIES_DESCRIPTION,
	SONADOR_DCMSR_DEVICE_NUMBER,
	SONADOR_DCMSR_CONTENT_QUALIFICATION
} = SREnums;


const EVENTS = {
	MEASUREMENT_REPRESENTATION_ADDED: 'api-event::measurement-representation_added',
	MEASUREMENT_REPRESENTATION_UPDATED: 'api-event::measurement-representation_updated',
	MEAUSREMENT_CLEAR_START: 'api-event::measurements:clear::start',
	MEASUREMENT_CLEAR_SUCCESS: 'api-event::measurements::clear::success',

	MEASUREMENT_PERSIST_START: 'api-event:measurements:save:start',
	MEASUREMENT_PERSIST_SUCCESS: 'api-event:measurements:save:success',
	MEASUREMENT_DCMSR_ENCODE_START: 'api-event:measurements:DCMSR-encode:start',
	MEASUREMENT_DCMSR_ENCODE_MEASUREMENT: 'api-event:measurements:DCMSR-encode-measurement',
	MEASUREMENT_DCMSR_ENCODE_SUCCESS: 'api-event:measurements:DCMSR-encode:success',
	
	MEASUREMENT_DCMSR_PARSE_START: 'api-event::measurements::DCMSR-parse:start',
	MEASUREMENT_DCMSR_PARSE_MEAUSREMENT: 'api-event::measurements::DCMSR-parse-measurement',
	MEASUREMENT_DCMSR_PARSE_SUCCESS: 'api-event::measurements::DCMSR-parse::success',
}


const DCM = {
	SONADOR_PROJECT,
	SONADOR_VIEWER,
	SONADOR_MEASUREMENT_REPORT_SERIES_DESCRIPTION,
	SONADOR_DCMSR_DEVICE_NUMBER,
	SONADOR_DCMSR_CONTENT_QUALIFICATION,
}


export const Cornerstone = {
	CORNERSTONE_TOOLS_SOURCE_NAME,
	CORNERSTONE_TOOLS_SOURCE_VERSION,

	// Options for parsing SR documents: uses Cornerstone Classic/Legacy schema for annotation data
	sr: {
		name: CORNERSTONE_TOOLS_SOURCE_NAME, version: CORNERSTONE_TOOLS_SOURCE_VERSION,
		measurementReport: CornerstoneMeasurementReport,
		adapters: c3dAdaptersSR.Cornerstone,
	}
}

export const Cornerstone3D = {
	CORNERSTONE_3D_TOOLS_SOURCE_NAME,
	CORNERSTONE_3D_TOOLS_SOURCE_VERSION,

	// Options for parsing SR documents: uses Cornerstone 3D schema for annotation data
	sr: {
		name: CORNERSTONE_3D_TOOLS_SOURCE_NAME, version: CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
		measurementReport: Cornerstone3dMeasurementReport,
		adapters: c3dAdaptersSR.Cornerstone3D,
	}
}


export const Sonador = {
	SONADOR_PROJECT,
	SONADOR_VIEWER,
}


const Enums = {
	SONADOR_PROJECT,
	SONADOR_VIEWER,
	CORNERSTONE_TOOLS_SOURCE_NAME, 
	CORNERSTONE_TOOLS_SOURCE_VERSION,
	CORNERSTONE_3D_TOOLS_SOURCE_NAME,
	CORNERSTONE_3D_TOOLS_SOURCE_VERSION,
	SERVICE_EVENTS,
	EVENTS,
	DCM,
	Cornerstone,
	Cornerstone3D,
	Sonador,
	SREnums,
};


export default Enums;
export { Enums, SREnums, DCM, EVENTS, SERVICE_EVENTS };