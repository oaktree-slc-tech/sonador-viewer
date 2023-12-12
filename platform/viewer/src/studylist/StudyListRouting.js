import React, { useContext } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useParams } from 'react-router-dom';
import * as _ from 'lodash';

import { DICOMWeb, OHIF } from '@ohif/core';

import AppContext from '../context/AppContext';
import useServer from '../hooks/useServer';
import NotFound from '../pages/NotFound/NotFound';

import ConnectedStudyList from './ConnectedStudyList';

const { urlUtil: UrlUtil } = OHIF.utils;

// Contexts

function StudyListRouting() {
  const routeLocation = useLocation();
  // Manage routes for the Sonador study list

  const { project, location, dataset, dicomStore, token } = useParams();

  // Determine which server to use: if unable to find active server, return 404
  const servers = useSelector((state) => state && state.servers);
  const server = useServer({ project, location, dataset, dicomStore, token });

  // Server list is defined, but there is no active server: return 404.
  // Where there is not a defined server list, the route should still return
  // the study list, since it handles the empty state of the application.
  const { appConfig = {} } = useContext(AppContext);

  if (_.isArray((servers || {}).servers) && servers.length && !server) {
    return <NotFound message="Invalid server instance" />;
  }

  // Parse query string parameters
  const filters = UrlUtil.queryString.getQueryFilters(routeLocation, DICOMWeb.dcmStudyTags);

  // Turn on/off study list functions
  let studyListFunctionsEnabled = false;
  if (appConfig.studyListFunctionsEnabled) {
    studyListFunctionsEnabled = appConfig.studyListFunctionsEnabled;
  }

  // Return study list: handles both empty state and study list for the active server
  return <ConnectedStudyList filters={filters} studyListFunctionsEnabled={studyListFunctionsEnabled} />;
}

export default StudyListRouting;
