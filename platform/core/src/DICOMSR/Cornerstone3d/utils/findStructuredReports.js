import _ from 'lodash';

import { isStructuredReportSeries } from './findMostRecentStructuredReport';


const findStructuredReport = studies => {
	// Find all structured reports in the provided series

	const srSeries = [];

	studies.forEach(study => {
		const allSeries = study.getSeries ? study.getSeries() : [];
		allSeries.forEach(sx => {

			// Skip series that may not have instances yet. May happen when 
			// the initial details have been retrieved but not the full metadata.
			const images = sx.instances || sx.images || sx._instances;

			if (!images) {
				return;
			}

			if (isStructuredReportSeries(sx)) {
				srSeries.push(sx);
			}
		});
	});

	return srSeries;
}


export default findStructuredReport;
export { findStructuredReport };