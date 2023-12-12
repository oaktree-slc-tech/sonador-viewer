import React from 'react';
import { useLocation } from 'react-router-dom';

import OHIF from '@ohif/core';

import ConnectedViewerRetrieveStudyData from '../connectedComponents/ConnectedViewerRetrieveStudyData.js';

const { urlUtil: UrlUtil } = OHIF.utils;

function IHEInvokeImageDisplay() {
  const location = useLocation();
  const {
    // patientID,
    requestType,
    studyUID,
  } = UrlUtil.parse(location.search);

  switch (requestType) {
    case 'STUDY':
      return <ConnectedViewerRetrieveStudyData studyInstanceUIDs={studyUID.split(';')} />;

    case 'STUDYBASE64':
      return <ConnectedViewerRetrieveStudyData studyInstanceUIDs={UrlUtil.paramString.parseParam(studyUID)} />;

    case 'PATIENT':
      // TODO: connect this to the StudyList when we have the filter parameters set up
      // return <StudyList patientUIDs={patientID.split(';')} />;
      return '';

    default:
      // TODO: Figure out what to do here, this won't work because StudyList expects studies
      // return <StudyList />;
      return '';
  }
}

export default IHEInvokeImageDisplay;
