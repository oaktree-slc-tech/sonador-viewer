import React from 'react';
import { useParams } from 'react-router-dom';
import PropTypes from 'prop-types';

import { user, utils } from '@ohif/core';

import ConnectedViewerRetrieveStudyData from '../connectedComponents/ConnectedViewerRetrieveStudyData';
import useQuery from '../hooks/useQuery';
import useServer from '../hooks/useServer';

const { urlUtil: UrlUtil } = utils;

/**
 * Get array of seriesUIDs from param or from queryString
 * @param {*} seriesInstanceUIDs
 * @param {*} routeLocation
 */
const getSeriesInstanceUIDs = (seriesInstanceUIDs, routeLocation) => {
  const queryFilters = UrlUtil.queryString.getQueryFilters(routeLocation);
  const querySeriesUIDs = queryFilters && queryFilters['seriesInstanceUID'];
  const _seriesInstanceUIDs = seriesInstanceUIDs || querySeriesUIDs;

  return UrlUtil.paramString.parseParam(_seriesInstanceUIDs);
};


function ViewerRouting({ location: routeLocation }) {
  const { project, location, dataset, dicomStore, studyInstanceUIDs, seriesInstanceUIDs } = useParams();

  // Set the user's default authToken for outbound DICOMWeb requests.
  // Is only applied if target server does not set `requestOptions` property.
  //
  // See: `getAuthorizationHeaders.js`
  let query = useQuery();
  const authToken = query.get('token');

  if (authToken) {
    user.getAccessToken = () => authToken;
  }

  const server = useServer({ project, location, dataset, dicomStore });
  const studyUIDs = UrlUtil.paramString.parseParam(studyInstanceUIDs);
  const seriesUIDs = getSeriesInstanceUIDs(seriesInstanceUIDs, routeLocation);

  if (server && studyUIDs) {
    return <ConnectedViewerRetrieveStudyData studyInstanceUIDs={studyUIDs} seriesInstanceUIDs={seriesUIDs} />;
  }

  return null;
}


ViewerRouting.propTypes = {
  location: PropTypes.any,
};

export default ViewerRouting;
