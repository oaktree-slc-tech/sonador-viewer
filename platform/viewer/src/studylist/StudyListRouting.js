import * as _ from 'lodash';
import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { OHIF, DICOMWeb } from '@ohif/core';
import ConnectedStudyList from './ConnectedStudyList';
import useServer from '../customHooks/useServer';
import NotFound from '../routes/NotFound.js';
import AppContext from '../context/AppContext';

const { urlUtil: UrlUtil } = OHIF.utils;

// Contexts

function StudyListRouting({ match: routeMatch, location: routeLocation }) {
  // Manage routes for the Sonador study list

  const {
    project,
    location,
    dataset,
    dicomStore,
    studyInstanceUIDs,
    seriesInstanceUIDs,
    token,
  } = routeMatch.params;

  // Determine which server to use: if unable to find active server, return 404
  const servers = useSelector(state => state && state.servers);
  const server = useServer({ project, location, dataset, dicomStore, token });

  // Server list is defined, but there is no active server: return 404.
  // Where there is not a defined server list, the route should still return
  // the study list, since it handles the empty state of the application.
  const { appConfig = {} } = useContext(AppContext);

  if (_.isArray((servers || {}).servers) && servers.length && !server) {
    return <NotFound message="Invalid server instance" />;
  }

  // Parse query string parameters
  const filters = UrlUtil.queryString.getQueryFilters(
    routeLocation,
    DICOMWeb.dcmStudyTags
  );

  // Turn on/off study list functions
  let studyListFunctionsEnabled = false;
  if (appConfig.studyListFunctionsEnabled) {
    studyListFunctionsEnabled = appConfig.studyListFunctionsEnabled;
  }

  // Return study list: handles both empty state and study list for the active server
  return (
    <ConnectedStudyList
      filters={filters}
      studyListFunctionsEnabled={studyListFunctionsEnabled}
    />
  );
}

StudyListRouting.propTypes = {
  location: PropTypes.shape({
    search: PropTypes.string,
  }).isRequired,
  match: PropTypes.object,
};

export default withRouter(StudyListRouting);
