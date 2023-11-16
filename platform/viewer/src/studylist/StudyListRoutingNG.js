import React from 'react';
import { useSelector } from 'react-redux';
import { useParams } from 'react-router-dom';
import { isArray } from 'lodash';

import useServer from '../customHooks/useServer';
import NotFound from '../routes/NotFound.js';

import StudyListPageNG from './StudyListPageNG/StudyListPageNG';

export default function StudyListRoutingNG() {
  const { project, location, dataset, dicomStore, token } = useParams();

  const servers = useSelector((state) => state && state.servers);
  const server = useServer({ project, location, dataset, dicomStore, token });

  if (isArray((servers || {}).servers) && servers.length && !server) {
    return <NotFound message="Invalid server instance" />;
  }

  return <StudyListPageNG />;
}
