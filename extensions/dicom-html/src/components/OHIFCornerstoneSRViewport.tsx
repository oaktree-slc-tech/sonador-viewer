import PropTypes from 'prop-types';
import React from 'react';

import { Theme } from '@radix-ui/themes';

import OHIFCornerstoneSRMeasurementViewport from './OHIFCornerstoneSRMeasurementViewport';
import OHIFCornerstoneSRTextViewport from './OHIFCornerstoneSRTextViewport';

import './DicomHtmlViewport.css';


function OHIFCornerstoneSRViewport(props: withAppTypes) {
  const { displaySets } = props;
  const { isImagingMeasurementReport } = displaySets[0];

  return <div className="dcm-sr-html-viewport">
    <div className="radix-scope"><Theme>
      <OHIFCornerstoneSRTextViewport {...props}></OHIFCornerstoneSRTextViewport>
    </Theme></div>
  </div>;
}


OHIFCornerstoneSRViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),  
  dataSource: PropTypes.object,
  children: PropTypes.node,
  viewportLabel: PropTypes.string,
  viewportOptions: PropTypes.object,
  servicesManager: PropTypes.object.isRequired,
};


export default OHIFCornerstoneSRViewport;