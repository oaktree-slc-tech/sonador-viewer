import React from 'react';
import { useSelector } from 'react-redux';
import { isArray } from 'lodash';

import NotFound from '../pages/NotFound/NotFound';
import StudyListPageNG from '../pages/StudyListPageNG/StudyListPageNG';

export default function StudyListRoutingNG() {
  const servers = useSelector((state) => state && state.servers);
  const activeServer = servers.servers.find((s) => s.active);

  if (isArray((servers || {}).servers) && servers.length && !activeServer) {
    return <NotFound message="Invalid server instance" />;
  }

  return <StudyListPageNG />;
}
