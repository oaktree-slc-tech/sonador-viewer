// DisplaySet interface for the Sonador viewer. Provides a uniform mechanism to interface
// with displaySets, the metadata and rendering state objects for the viewer. A single
// displaySet is a general entities with links to display objects (such as images, measurements,
// and segmentations) associated with a series. A viewport renders a display set in a displayable
// object. Display sets are created from series metadata.

// DisplaySets get initialized at the time study metadata is loaded by the viewer and cleared
// when the viewer is unloaded. During their initialization, `SOPClassHandlerids` of the viewer
// are executed to generate display properties.

// Because of their relationship to metadata and rendering, the DisplaySetApi within the 
// Sonador viewer is used to track and signal changes for viewports, data loading, and
// viewer lifecycle.

// This module is designed to provide a singleton instance fo the API which can be accessed
// via the DisplaySetApi.Instance property. The API instance should be initialized
// in the Viewer App.

import _ from 'lodash';
import Enums, { EVENTS } from '../enums';


export default class DisplaySetApi {
  // Sonador Viewer DisplaySetApi
  static Instance;

  constructor(displaySetService, dcmMetaStore, options={}) {
    options = options || {};

    if (DisplaySetApi.Instance) {
      DisplaySetApi.Instance.initialize(displaySetService, dcmMetaStore, options);
      return DisplaySetApi.Instance;
    }

    this.initialize(displaySetService, dcmMetaStore, options);
    DisplaySetApi.Instance = this;
  }

  initialize(displaySetService, dcmMetaStore, options={}) {
    // Initialize DisplaySetApi instance

    // DisplaySetService and DicomMetadataStore
    this.displaySetService = displaySetService;
    this.dcmMetaStore = dcmMetaStore;

    // Ensure that a valid displaySet service instance is provided for the API
    if (!this.displaySetService) {
      throw new Error('Unable to initialize DisplaySetApi, invalide DisplaySetService');
    }
    if (!this.dcmMetaStore) {
      throw new Error('Unable to initialize DisplaySetApi, invalid dcmMetaStore');
    }

    // Subscribe to changes in the DisplaySetService
    this.subscription_datasync = this.displaySetService.subscribe(
      this.displaySetService.EVENTS.DISPLAY_SET_DATASYNC, this.onServiceDataSync.bind(this));
  }

  destroy() {
    //  DisplaySet APIi instance teardown

    // Clear service
    this.displaySetService.onModeExit();

    // Unsubscribe events
    this.subscription_datasync.unsubscribe();
  }

  onServiceDataSync({ apiEvent }) {
    // Respond to service data sync API events
    log.debug('[displaySetApi:event:datasync-event] apiEvent='+apiEvent);
      
    // Clear displaySets from service on study reload
    if (apiEvent == Enums.EVENTS.STUDY_RELOAD) {
      this.displaySetService.clear();
    }
  }

  reloadStudy() {
    // Trigger a reload (via the service) of the study

    this.displaySetService.triggerApiEvent(EVENTS.STUDY_RELOAD);
  }
}