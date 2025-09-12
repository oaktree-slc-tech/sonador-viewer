import { isArray } from 'lodash';

import React, { useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';

import OHIF, { display } from '@ohif/core';

import { extensionManager, servicesManager, commandsManager } from '../App';
import NotFound from '../pages/NotFound/NotFound';
import UploadStudyPageNG from '../pages/UploadStudyPageNG/UploadStudyPageNG';

const { DicomMetadataStore } = OHIF;


export default function UploadsRoutingNG() {

  // Initialize services and API instances
  const displaySetApi = useMemo(() => {
    const { displaySetService } = servicesManager.services;

    return new display.DisplaySetApi(displaySetService, DicomMetadataStore);
  }, []);

  useEffect(() => {
    console.log('[viewer:uploads:route-init] component mounted')

    return () => {
      console.log('[viewer:uploads:route-init] component unmounted');

      // Release DisplaySetAPi event bindings
      displaySetApi.destroy?.();
    }
  }, [])

  const servers = useSelector((state) => state && state.servers);
  const activeServer = servers.servers.find((s) => s.active);

  if (isArray((servers || {}).servers) && servers.length && !activeServer) {
    return <NotFound message="Invalid server instance" />;
  }

  return <UploadStudyPageNG />;
}
