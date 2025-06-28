import _ from 'lodash';

import PropTypes from 'prop-types';
import React from 'react';

import OHIF from '@ohif/core';

import { OHIFCornerstoneSRContainer } from './OHIFCornerstoneSRContainer';

const { DicomMetadataStore, display } = OHIF;


function OHIFCornerstoneSRTextViewport(props: withAppTypes) {
  const { displaySets } = props;
  const { displaySetService } = display.DisplaySetApi.Instance;

  // Unpack DICOM-SR instance to be used as the "container" instance
  const displaySet = displaySets[0];
  let instance = displaySet.instances[0];

  if (!instance) {

    // Retrieve displaySet for series from displaySetService to back-fill instance using the
    // naturalized SR instance. Service instances will have the "canonical" representation of the display data.
    const srDisplaySet = _.chain(displaySetService.getDisplaySetsForSeries(displaySet.SeriesInstanceUID)).first().value();
    instance = srDisplaySet.srInstanceDataset;
  }

  if (!instance) {

    // Back-fill container from DicomMetadataService
    const sx = DicomMetadataStore.getSeries(displaySet.StudyInstanceUID, displaySet.SeriesInstanceUID);
    instance = sx.instances && sx.instances.length ? sx.instances[0] : undefined;
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-auto p-4 text-white">
      <div>
        {/* The root level is always a container */}
        <OHIFCornerstoneSRContainer container={instance} />
      </div>
    </div>
  );
}


OHIFCornerstoneSRTextViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),
  dataSource: PropTypes.object,
  children: PropTypes.node,
  viewportLabel: PropTypes.string,
  viewportOptions: PropTypes.object,
  servicesManager: PropTypes.object.isRequired,
};


export default OHIFCornerstoneSRTextViewport;