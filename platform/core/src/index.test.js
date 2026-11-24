/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Cornerstone3D packages are ESM builds jest cannot load here; the exports under test do not use them
jest.mock('@cornerstonejs/dicom-image-loader', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({
  utilities: {}, cache: {}, metaData: { addProvider: () => {} }, imageLoader: {}, eventTarget: {},
  Enums: { RequestType: { Interaction: 'interaction', Thumbnail: 'thumbnail', Prefetch: 'prefetch' }, MetadataModules: {}, Events: {} },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({ utilities: {}, Enums: {}, segmentation: {} }), { virtual: true });
jest.mock('@cornerstonejs/core/utilities/textureSupport', () => ({}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({}), { virtual: true });
// The SR modules extend the library adapters as they load: the adapters come from their ESM build
jest.mock('@cornerstonejs/adapters', () => {
  const adapters = '../../../node_modules/@cornerstonejs/adapters/dist/esm/adapters';
  const load = file => jest.requireActual(`${adapters}/${file}`).default;
  return {
    adaptersSR: {
      Cornerstone: {
        MeasurementReport: load('Cornerstone/MeasurementReport.js'), Length: load('Cornerstone/Length.js'),
        ArrowAnnotate: load('Cornerstone/ArrowAnnotate.js'),
      },
      Cornerstone3D: {
        MeasurementReport: load('Cornerstone3D/MeasurementReport.js'),
        BaseAdapter3D: load('Cornerstone3D/BaseAdapter3D.js'),
        Angle: load('Cornerstone3D/Angle.js'),
        CobbAngle: load('Cornerstone3D/CobbAngle.js'),
        Length: load('Cornerstone3D/Length.js'),
        CircleROI: load('Cornerstone3D/CircleROI.js'),
        Bidirectional: load('Cornerstone3D/Bidirectional.js'),
        ArrowAnnotate: load('Cornerstone3D/ArrowAnnotate.js'),
        CodeScheme: load('Cornerstone3D/CodingScheme.js'),
      },
    },
    helpers: { toArray: x => (Array.isArray(x) ? x : x !== undefined ? [x] : []) },
  };
}, { virtual: true });

import * as OHIF from './index.js';

describe('Top level exports', () => {
  test('have not changed', () => {
    const expectedExports = [
      'MODULE_TYPES',
      //
      'CommandsManager',
      'ExtensionManager',
      'HotkeysManager',
      'ServicesManager',
      //
      'UINotificationService',
      'UIModalService',
      'UIDialogService',
      'MeasurementService',
      'LoggerService',
      //
      'utils',
      'hotkeys',
      'studies',
      'redux',
      'classes',
      'metadata',
      'header',
      'cornerstone',
      'default', //
      'errorHandler',
      'str2ab',
      'string',
      'ui',
      'user',
      'object',
      'log',
      'DICOMWeb',
      'DICOMSR',
      'OHIF', //
      'measurements',
      'hangingProtocols',
      // Sonador additions
      'ANNOTATIONS_REGION_LEAD_VALUE_DEFAULT',
      'ANNOTATIONS_REGION_LEAD_VALUE_PREFERENCE_KEY',
      'ARCHIVE_JOB_STATES',
      'ArchiveDownloadService',
      'ArchiveDownloadServiceEvents',
      'CustomizationService',
      'DicomMetadataStore',
      'DisplaySetService',
      'DownloadManagerService',
      'DownloadManagerServiceEvents',
      'IWebApiDataSource',
      'JOB_STATES',
      'LANDMARKS_FOLLOW_SELECTION_DEFAULT',
      'LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY',
      'LOCKED_MODELS_WARNING_PREFERENCE_KEY',
      'UPLOAD_ATTEMPTS_PREFERENCE_KEY',
      'UPLOAD_ATTEMPTS_DEFAULT',
      'UPLOAD_ATTEMPTS_MIN',
      'UPLOAD_ATTEMPTS_MAX',
      'STUDY_ARCHIVE_LOADING_PREFERENCE_KEY',
      'STUDY_ARCHIVE_LOADING_DEFAULT',
      'LocalCacheService',
      'LocalCacheServiceEvents',
      'NotificationLogService',
      'NotificationLogServiceEvents',
      'NotificationLogSources',
      'PubSubService',
      'RETRY_ATTEMPTS_DEFAULT',
      'RETRY_ATTEMPTS_MAX',
      'RETRY_ATTEMPTS_MIN',
      'SEG_EDITOR_FOLLOW_SELECTION_DEFAULT',
      'SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY',
      'SEG_EDITOR_HOTKEY_DEFAULTS',
      'SEG_EDITOR_HOTKEY_PREFIX',
      'SEG_EDITOR_MESH_COLOR_AUTO',
      'SEG_EDITOR_MESH_COLOR_DEFAULT',
      'SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY',
      'SEG_EDITOR_PREVIEW_COLOR_DEFAULT',
      'SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY',
      'SERIES_TRANSFER_STATES',
      'SystemContextProvider',
      'TOOLBAR_SECTIONS',
      'TRANSFER_MODES',
      'ToolbarService',
      'UserPreferencesService',
      'UserPreferencesServiceEvents',
      'ViewportGridService',
      'ViewportRefsProvider',
      'canonicalKeyCombination',
      'clearOfflineStorageWithNotice',
      'display',
      'displayAttributes',
      'getToolbarUITypeEntries',
      'installLegacyBridge',
      'io',
      'notificationLogService',
      'notifyArchivesQueued',
      'notifySeriesQueued',
      'notifyStudiesQueued',
      'pubSubServiceInterface',
      'rehydrateStudyFromCache',
      'SessionArchiveLoader',
      'releaseRetainedInstances',
      'sonador',
      'sonadorLocalImageReader',
      'startArchiveNotifications',
      'startDownloadNotifications',
      'stopArchiveNotifications',
      'stopDownloadNotifications',
      'uiNotificationService',
      'useActiveToolOptions',
      'useSystem',
      'useToolbar',
      'useViewportRef',
    ].sort();

    const exports = Object.keys(OHIF).sort();

    expect(exports).toEqual(expectedExports);
  });
});
