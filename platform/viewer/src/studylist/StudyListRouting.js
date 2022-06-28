import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';

import { OHIF, DICOMWeb } from '@ohif/core';

import ConnectedStudyList from './ConnectedStudyList';
import useServer from '../customHooks/useServer';
import NotFound from '../routes/NotFound.js';

const { urlUtil: UrlUtil } = OHIF.utils;

// Contexts
import AppContext from '../context/AppContext';


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
  const server = useServer({ project, location, dataset, dicomStore, token });
  if (!server) {
    return <NotFound message='Invalid server instance' />;
  }

  const { appConfig = {} } = useContext(AppContext);

  // Parse query string parameters
  const filters = UrlUtil.queryString.getQueryFilters(
    routeLocation, DICOMWeb.dcmStudyTags);

  let studyListFunctionsEnabled = false;
  if (appConfig.studyListFunctionsEnabled) {
    studyListFunctionsEnabled = appConfig.studyListFunctionsEnabled;
  }
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
};

export default withRouter(StudyListRouting);
