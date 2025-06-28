import absoluteUrl from './absoluteUrl';
import addServers from './addServers';
import b64toBlob from './b64toBlob.js';
import { color } from './colors.js';
import DicomLoaderService from './dicomLoaderService.js';
import createEncapsulatedDocumentFileUrl from './EncapsulatedDocument.js';
import guid from './guid';
import * as hierarchicalListUtils from './hierarchicalListUtils';
import hotkeys from './hotkeys';
import isDicomUid from './isDicomUid';
import loadAndCacheDerivedDisplaySets from './loadAndCacheDerivedDisplaySets.js';
import makeCancelable from './makeCancelable';
import makeDeferred from './makeDeferred';
import ObjectPath from './objectPath';
import * as progressTrackingUtils from './progressTrackingUtils';
import Queue from './Queue';
import resolveObjectPath from './resolveObjectPath';
import sortBy from './sortBy.js';
import {
  sortStudy,
  sortStudySeries,
  sortStudyInstances,
  sortingCriteria,
  seriesSortCriteria,
  instancesSortCriteria,
} from './sortStudy';
import StackManager from './StackManager.js';
import studyMetadataManager from './studyMetadataManager';
import * as urlUtil from './urlUtil';
import writeScript from './writeScript.js';
import xhrRetryRequestHook from './xhrRetryRequestHook';
import dataProc from './dataProc.js';
import imageIdToURI from './imageIdToUri.js';
import roundNumber from './roundNumber.js'
import formatPN from './formatPN';
import formatDate from './formatDate';
import formatTime from './formatTime';
import getImageId from './getImageId';




// Tools for Working with Cornerstone3D
import { initCornerstone3d } from './cornerstone3d.js';


const cornerstone3dUtils = {

  // Initialize Cornerstone 3D tools within the Sonador viewer
  initCornerstone3d,
}



// Tools for Working with Cornerstone Classic
import refreshCornerstoneViewports from '../measurements/lib/refreshCornerstoneViewports';


const cornerstoneUtils = {

  // Refresh Cornerstone Viewports
  refreshCornerstoneViewports,
}



// General OHIF / Sonador Viewer Tools

const utils = {
  guid,
  ObjectPath,
  absoluteUrl,
  addServers,
  sortBy,
  sortStudy,
  sortStudySeries,
  sortStudyInstances,
  sortingCriteria,
  seriesSortCriteria,
  instancesSortCriteria,
  writeScript,
  b64toBlob,
  StackManager,
  studyMetadataManager,
  DicomLoaderService,
  urlUtil,
  loadAndCacheDerivedDisplaySets,
  makeDeferred,
  makeCancelable,
  hotkeys,
  Queue,
  isDicomUid,
  resolveObjectPath,
  hierarchicalListUtils,
  progressTrackingUtils,
  xhrRetryRequestHook,
  createEncapsulatedDocumentFileUrl,
  color,
  
  getImageId,
  imageIdToURI,

  dataProc,
  roundNumber,
  
  formatPN,
  formatDate,
  formatTime,
  
  cornerstone3dUtils,
  cornerstoneUtils,
};


export {
  guid,
  ObjectPath,
  absoluteUrl,
  addServers,
  sortBy,
  writeScript,
  b64toBlob,
  StackManager,
  studyMetadataManager,
  DicomLoaderService,
  urlUtil,
  loadAndCacheDerivedDisplaySets,
  makeDeferred,
  makeCancelable,
  hotkeys,
  Queue,
  isDicomUid,
  resolveObjectPath,
  hierarchicalListUtils,
  progressTrackingUtils,
  xhrRetryRequestHook,
  createEncapsulatedDocumentFileUrl,

  getImageId,
  imageIdToURI,

  dataProc,
  roundNumber,
  
  formatPN,
  formatDate,
  formatTime,  
  
  cornerstone3dUtils,
  cornerstoneUtils,
};


export default utils;
