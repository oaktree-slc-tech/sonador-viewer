/**
 * Entry point for development and production PWA builds.
 * Packaged (NPM) builds go through `index-umd.js`
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

// OHIF Server Components
import { utils } from '@ohif/core';
import OHIFDicomEkgExtension from '@ohif/extension-dicom-ecg';
import OHIFDicomHtmlExtension from '@ohif/extension-dicom-html';
import OHIFDicomMicroscopyExtension from '@ohif/extension-dicom-microscopy';
import OHIFDicomPDFExtension from '@ohif/extension-dicom-pdf';
import OHIFDicomRtExtension from '@ohif/extension-dicom-rt';
import OHIFDicomSegmentationExtension from '@ohif/extension-dicom-segmentation';
import OHIFDicomTagBrowserExtension from '@ohif/extension-dicom-tag-browser';
import OHIFSegEditorExtension from '@ohif/extension-seg3d-editor';
import OHIF3DVolumeViewerExtension from '@ohif/extension-viewer3d-volume';
import OHIFM3DViewerExtension from '@ohif/extension-viewerm3d';
/**
 * EXTENSIONS
 * =================
 *
 * Importing and modifying the extensions our app uses HERE allows us to leverage
 * tree shaking and a few other niceties. However, by including them here they become
 * "baked in" to the published application.
 *
 * Depending on your use case/needs, you may want to consider not adding any extensions
 * by default HERE, and instead provide them via the extensions configuration key or
 * by using the exported `App` component, and passing in your extensions as props using
 * the defaultExtensions property.
 */
import OHIFVTKExtension from '@ohif/extension-vtk';

import 'regenerator-runtime/runtime';

// Add this for Debugging purposes:
//import OHIFDebuggingExtension from '@ohif/extension-debugging';
import viewerPackage from '../package.json';

import App from './App.js';
import { uiNotificationService } from '@ohif/core';

const initOHIFViewer = function () {
  // Initialize OHIF viewer
  // 1. Create ReactJS app
  // 2. On init of the application, retrieve server list from Sonador
  // 3. Retrieve studies from PACS
  if (window) {
    config = window.config || {};
    window.version = viewerPackage.version;
    window.sonador = {
      ...window.sonador,
      home: {
        message:
          'Your user account is not associated with any imaging servers. Please contact your system administrator.',
      },
    };
  }

  const appProps = {
    config,
    defaultExtensions: [
      OHIFDicomHtmlExtension,
      OHIFDicomMicroscopyExtension,
      OHIFDicomPDFExtension,
      OHIFDicomSegmentationExtension,
      OHIFDicomRtExtension,
      OHIFDicomEkgExtension,

      // 3D Visualization and Segmentation Editing
      OHIFVTKExtension,
      OHIF3DVolumeViewerExtension,
      OHIFM3DViewerExtension,
      OHIFSegEditorExtension,

      // Metadata
      OHIFDicomTagBrowserExtension,
    ],
  };

  // Initialize and render application
  const app = React.createElement(App, appProps, null);
  createRoot(document.getElementById('root')).render(app);

  // Retrieve Sonador PACS server list
  if (window.sonador && window.sonador.host) {
    var sonador_pacsurl = window.sonador.host + window.sonador.api.pacs;

    fetch(sonador_pacsurl, {
      credentials: 'include',
    })
      .then( async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          uiNotificationService.show({
            title: 'Unable to initialize the viewer',
            message: 'The PACS server list could not be retrieved from Sonador.',
            type: 'error',
            autoClose: false,
          });
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        return response.json();
      })
      .then(function (servers) {
        if (!Array.isArray(servers)) servers = [servers];

        // Set dicomWeb server list and fetch studies
        window.config.servers.dicomWeb = servers;
        utils.addServers(window.config.servers, window.store);
      })
      .catch(function (err) {
        console.error(
          'Unable to initialize OHIF, unable to retrieve PACS server list from Sonador due to an error.',
          err
        );
      });
  }
};

// Check for Sonador config URL, if present, fetch the configuration
if (window && window.sonador && window.sonador.host) {
  var sonador_configurl = window.sonador.host + window.sonador.api.config;
  console.log('Initialize OHIF from remote configuration: ', sonador_configurl);

  // Retrieve Sonador Remote Configuration
  fetch(sonador_configurl)
    .then((response) => response.json())
    .then(function (ohifconfig) {
      window.config = ohifconfig;

      // Logos and branding for viewer
      window.config.whiteLabeling = {
        
        // Logo
        createLogoComponentFn: function (React) {
          return React.createElement('a', {
            // Create link with Sonador message
            target: '_self',
            href: '/',
            className: 'header-brand',
            rel: 'noopener noreferrer',
            style: {
              height: '36px',
              width: '165px',
              backgroundImage: 'url(' + ohifconfig.branding.logo + ')',
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            },
          });
        },
        emptyStateMessageFn: function(React) {
          return window.config?.branding?.empty_state
            || 'Your user account is not associated with any imaging servers. Please contact your system administrator';
        },
        signedOutMessageFn: function(React) {
          return window.config?.branding?.farewell
            || '# Signed Out\n\nYou have been logged out of Sonador successfully.';
        }
      };

      // Start empty set of servers (populated after session token is retrieved and
      // user authenticates to the Sonador web application)
      window.config.servers = { dicomWeb: [] };
      window.config.studyListFunctionsEnabled = true;

      // Initialize viewer
      initOHIFViewer();
    })
    .catch(function (err) {
      console.error('Unable to load OHIF configuration from remote config: ', window.sonador.config, err);
    });
} else {
  initOHIFViewer();
}
