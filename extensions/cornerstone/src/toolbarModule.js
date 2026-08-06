// TODO: A way to add Icons that don't already exist?
// - Register them and add
// - Include SVG Source/Inline?
// - By URL, or own component?

// What KINDS of toolbar buttons do we have...
// - One's that dispatch commands
// - One's that set tool's active
// - More custom, like CINE
//    - Built in for one's like this, or custom components?

// Visible?
// Disabled?
// Based on contexts or misc. criteria?
//  -- ACTIVE_ROUTE::VIEWER
//  -- ACTIVE_VIEWPORT::CORNERSTONE
// setToolActive commands should receive the button event that triggered
// so we can do the "bind to this button" magic

import { TOOLBAR_BUTTON_TYPES, TOOLBAR_BUTTON_BEHAVIORS } from '@ohif/ui';

import { SeriesTagToolbarButton } from './toolbarComponents/SeriesTagToolbarButton.js';
import { DistortionFilterToolbarButton } from './toolbarComponents/DistortionFilterToolbarButton.js';
import { LocalCacheToolbarButton } from './toolbarComponents/LocalCacheToolbarButton.js';
import { DownloadStudyToolbarButton } from './toolbarComponents/DownloadStudyToolbarButton.js';
import { RemoveStudyToolbarButton } from './toolbarComponents/RemoveStudyToolbarButton.js';

/* TODO: Export enums through a extension manager. */
const enums = {
  TOOLBAR_BUTTON_TYPES,
  TOOLBAR_BUTTON_BEHAVIORS,
};

const definitions = [
  {
    id: 'StackScroll',
    label: 'Stack Scroll',
    icon: 'bars',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'setToolActive',
    commandOptions: { toolName: 'StackScroll' },
  },
  {
    id: 'Zoom',
    label: 'Zoom',
    icon: 'search-plus',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Zoom' },
  },
  {
    id: 'Wwwc',
    label: 'Levels',
    icon: 'level',    
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Wwwc' },
  },
  {
    id: 'Pan',
    label: 'Pan',
    icon: 'arrows',
    type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Pan' },
  },
  {
    id: 'AnnotationTools',
    label: 'Annotate',
    icon: 'measure-target',
    buttons: [
      {
        id: 'Length',
        label: 'Length',
        icon: 'measure-temp',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'Length' },
      },
      {
        id: 'ArrowAnnotate',
        label: 'Annotate',
        icon: 'measure-non-target',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'ArrowAnnotate' },
      },
      {
        id: 'Angle',
        label: 'Angle',
        icon: 'angle-left',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'Angle' },
      },
      {
        id: 'Bidirectional',
        label: 'Bidirectional',
        icon: 'measure-target',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'Bidirectional' },
      },
      {
        id: 'EllipticalRoi',
        label: 'Ellipse',
        icon: 'circle-o',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'EllipticalRoi' },
      },
      {
        id: 'RectangleRoi',
        label: 'Rectangle',
        icon: 'square-o',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'RectangleRoi' },
      },
      { 
        // Add tag to the current series
        id: 'SeriesTag',
        label: 'Series Tag',
        icon: 'tags',
        CustomComponent: SeriesTagToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'seriesTagDialog',
      },
      {
        // Check study against distortion filter API
        id: 'DistortionFilter',
        label: 'Check Distortion',
        icon: 'microscope',
        CustomComponent: DistortionFilterToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'checkDistortionFilterDialog',
      },
      {
        // Clear and reload annotations
        id: 'ReloadAnnotations',
        label: 'Reload',
        icon: 'reset',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'reloadAnnotations',
      },
      { 
        // Clear measurements and annotations
        id: 'Clear',
        label: 'Clear',
        icon: 'trash',        
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'clearAnnotations',
      },
    ]
  },
  {
    id: 'Cine',
    label: 'CINE',
    icon: 'youtube',
    type: TOOLBAR_BUTTON_TYPES.BUILT_IN,
    options: {
      behavior: TOOLBAR_BUTTON_BEHAVIORS.CINE,
    },
  },
  {
    id: 'Reset',
    label: 'Reset',
    icon: 'reset',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'resetViewport',
  },
  {
    id: 'More',
    label: 'More',
    icon: 'ellipse-circle',
    buttons: [
      {
        id: 'Magnify',
        label: 'Magnify',
        icon: 'circle',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'Magnify' },
      },
      {
        id: 'WwwcRegion',
        label: 'ROI Window',
        icon: 'stop',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'WwwcRegion' },
      },
      {
        id: 'DragProbe',
        label: 'Probe',
        icon: 'dot-circle',
        type: TOOLBAR_BUTTON_TYPES.SET_TOOL_ACTIVE,
        commandName: 'setToolActive',
        commandOptions: { toolName: 'DragProbe' },
      },
      {
        id: 'Invert',
        label: 'Invert',
        icon: 'adjust',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'invertViewport',
      },
      {
        id: 'RotateRight',
        label: 'Rotate Right',
        icon: 'rotate-right',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'rotateViewportCW',
      },
      {
        id: 'FlipH',
        label: 'Flip H',
        icon: 'ellipse-h',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'flipViewportHorizontal',
      },
      {
        id: 'FlipV',
        label: 'Flip V',
        icon: 'ellipse-v',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'flipViewportVertical',
      },
      {
        // Captures the CURRENTLY DISPLAYED IMAGE off the viewport canvas as a PNG/JPEG. It was
        // labelled "Download", which described neither the scope (one image, not the study) nor
        // the action (a screen capture, not a DICOM export) -- and it now sits in the same menu as
        // a real study download (ohif-viewers#127, AR-9). Verb + object, sentence case, no
        // redundant "image of the current series": the menu is already viewport-scoped.
        id: 'CaptureImage',
        label: 'Capture Image',
        icon: 'create-screen-capture',
        type: TOOLBAR_BUTTON_TYPES.BUILT_IN,
        options: {
          behavior: TOOLBAR_BUTTON_BEHAVIORS.DOWNLOAD_SCREEN_SHOT,
          togglable: true,
        },
      },
      {
        // Export the whole study as a .zip, the study-list row menu's Download reachable from the
        // viewer. CustomComponent purely so it can be hidden from a user without `view`.
        id: 'DownloadStudy',
        label: 'Download',
        icon: 'cloud-download',
        CustomComponent: DownloadStudyToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'downloadStudyArchive',
      },
      {
        // Local/offline study cache toggle (ohif-viewers#125, FR-9). CustomComponent branches
        // label/icon/command on live cache state; distinct id/command from the 'Download'
        // (screenshot) and study-list 'download' (zip) features (AR-6).
        id: 'LocalCache',
        label: 'Save Offline Copy',
        icon: 'offline-cache',
        CustomComponent: LocalCacheToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'goOffline',
      },
      {
        id: 'ReloadStudy',
        label: 'Reload Study',
        icon: 'reset',
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        commandName: 'reloadStudy',
      },
      {
        // Permanently delete the open study from the imaging server, behind the study list's
        // blocking confirmation; the tab closes once the user has read the result. Last in the
        // menu, and deliberately not adjacent to 'LocalCache' above, which removes only THIS
        // BROWSER's cached copy (ohif-viewers#127, AR-9).
        id: 'RemoveStudy',
        label: 'Remove Study',
        icon: 'trash',
        CustomComponent: RemoveStudyToolbarButton,
        type: TOOLBAR_BUTTON_TYPES.COMMAND,
        // No commandName on purpose. The CustomComponent owns the confirmation and the removal, so
        // it never calls toolbarClickCallback; ToolbarRow guards on `if (button.commandName)`, so
        // omitting it is inert. Registering one would create a second path to an irreversible
        // delete that bypasses the confirmation entirely.
      },
    ],
  },
  {
    // Exit 2D MPR View
    id: 'Exit2DMPR',
    label: 'Exit 2D MPR',
    icon: 'times',
    type: TOOLBAR_BUTTON_TYPES.COMMAND,
    commandName: 'setCornerstoneLayout',
    context: 'ACTIVE_VIEWPORT::VTK',
    uiOptions: { layoutButtonVisible: true },
  },
];

export default {
  definitions,
  defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',
};
