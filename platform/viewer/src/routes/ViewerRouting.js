import React from 'react';
import { useParams } from 'react-router-dom';
import PropTypes from 'prop-types';

import { user, utils } from '@ohif/core';

import ConnectedViewerRetrieveStudyData from '../connectedComponents/ConnectedViewerRetrieveStudyData';
import useQuery from '../hooks/useQuery';
import useServer, { activateServer } from '../hooks/useServer';

const { urlUtil: UrlUtil } = utils;


const getSeriesInstanceUIDs = (seriesInstanceUIDs, routeLocation) => {
  /**
  * Get array of seriesUIDs from param or from queryString
  * @param {*} seriesInstanceUIDs
  * @param {*} routeLocation
  */

  const queryFilters = UrlUtil.queryString.getQueryFilters(routeLocation);
  const querySeriesUIDs = queryFilters && queryFilters['seriesInstanceUID'];
  const _seriesInstanceUIDs = seriesInstanceUIDs || querySeriesUIDs;

  return UrlUtil.paramString.parseParam(_seriesInstanceUIDs);
};


function ViewerRouting({ location: routeLocation }) {

  // Unpack route, dataset, and study/series identifiers
  const params = useParams();
  const { project, location, token: serverToken, dataset, dicomStore, studyInstanceUIDs, seriesInstanceUIDs } = params;

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

  // Activate the server specified in the route URL (if not already active)
  if (server && serverToken && server.token != serverToken)  {    
    activateServer(serverToken);
  }

  if (server && studyUIDs) {
    return <ConnectedViewerRetrieveStudyData studyInstanceUIDs={studyUIDs} seriesInstanceUIDs={seriesUIDs} />;
  }

  return null;
}


ViewerRouting.propTypes = {
  location: PropTypes.any,
};


export default ViewerRouting;
