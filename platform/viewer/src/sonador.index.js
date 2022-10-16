/**
 * Entry point for development and production PWA builds.
 * Packaged (NPM) builds go through `index-umd.js`
 */

import 'regenerator-runtime/runtime';

import App from './App.js';
import React from 'react';
import ReactDOM from 'react-dom';

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
import OHIFDicomHtmlExtension from '@ohif/extension-dicom-html';
import OHIFDicomSegmentationExtension from '@ohif/extension-dicom-segmentation';
import OHIFDicomRtExtension from '@ohif/extension-dicom-rt';
import OHIFDicomMicroscopyExtension from '@ohif/extension-dicom-microscopy';
import OHIFDicomPDFExtension from '@ohif/extension-dicom-pdf';
import OHIFDicomTagBrowserExtension from '@ohif/extension-dicom-tag-browser';

// OHIF Server Components
import { utils } from '@ohif/core';
import store from './store';

// Add this for Debugging purposes:
//import OHIFDebuggingExtension from '@ohif/extension-debugging';
import { version } from '../package.json';

const initOHIFViewer = function() {
  // Initialize OHIF viewer
  // 1. Create ReactJS app
  // 2. On init of the application, retrieve server list from Sonador
  // 3. Retrieve studies from PACS
  if (window) {
    config = window.config || {};
    window.version = version;
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
      OHIFVTKExtension,
      OHIFDicomHtmlExtension,
      OHIFDicomMicroscopyExtension,
      OHIFDicomPDFExtension,
      OHIFDicomSegmentationExtension,
      OHIFDicomRtExtension,
      OHIFDicomTagBrowserExtension,
      //OHIFDebuggingExtension,
    ],
  };

  // Initialize and render application
  const app = React.createElement(App, appProps, null);
  ReactDOM.render(app, document.getElementById('root'), function() {
    // Retrieve Sonador PACS server list
    if (window.sonador && window.sonador.host) {
      var sonador_pacsurl = window.sonador.host + window.sonador.api.pacs;

      fetch(sonador_pacsurl, {
        credentials: 'include',
      })
        .then(response => response.json())
        .then(function(servers) {
          console.log(servers, 'here');
          if (!Array.isArray(servers)) servers = [servers];

          // Set dicomWeb server list and fetch studies
          window.config.servers.dicomWeb = servers;
          utils.addServers(window.config.servers, store);
        })
        .catch(function(err) {
          console.log(
            'Unable to initialize OHIF, unable to retrieve PACS server list from Sonador due to an error.',
            err
          );
        });
    }
  });
};

// Check for Sonador config URL, if present, fetch the configuration
if (window && window.sonador && window.sonador.host) {
  var sonador_configurl = window.sonador.host + window.sonador.api.config;
  console.log('Initialize OHIF from remote configuration: ', sonador_configurl);

  // Retrieve Sonador Remote Configuration
  fetch(sonador_configurl)
    .then(response => response.json())
    .then(function(ohifconfig) {
      window.config = ohifconfig;

      // Logos and branding for viewer
      window.config.whiteLabeling = {
        // Logo
        createLogoComponentFn: function(React) {
          return React.createElement('a', {
            rel: 'noopener noreferrer',
            target: '_self',
            href: '/',
            className: 'header-brand',
            rel: 'noopener noreferrer',
            style: {
              height: '50px',
              width: '165px',
              backgroundImage: 'url(' + ohifconfig.branding.logo + ')',
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'left',
            },
          });
        },
      };

      // Start empty set of servers (populated after session token is retrieved and
      // user authenticates to the Sonador web application)
      window.config.servers = { dicomWeb: [] };
      window.config.studyListFunctionsEnabled = true;

      // Initialize viewer
      initOHIFViewer();
    })
    .catch(function(err) {
      console.log(
        'Unable to load OHIF configuration from remote config: ',
        window.sonador.config,
        err
      );
    });
} else {
  initOHIFViewer();
}
