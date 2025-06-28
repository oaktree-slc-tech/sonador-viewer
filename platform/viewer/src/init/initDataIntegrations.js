// Initialize OHIF v3 Data Service Integrations for the Sonador Viewer.

import _ from 'lodash';

import OHIF from '@ohif/core';
const { DicomMetadataStore } = OHIF;


function initDataServiceIntegration({ servicesManager }) {
	// Initialize data service integration and callbacks: configure OHIF v3 DisplaySetService and 
	// DicomMetaData store.

	const {
    	displaySetService,
    	customizationService,
	} = servicesManager.services;

	console.log('[viewer:init:data-services] Initialize core data integrations for Sonador Viewer');
}


export { initDataServiceIntegration, }