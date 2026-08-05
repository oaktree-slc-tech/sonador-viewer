import { ScrollableArea } from './ScrollableArea/ScrollableArea.js';
import setLayoutAndViewportData from './utils/setLayoutAndViewportData.js';
import setMultiPanelLayout from './utils/setMultiPanelLayout.js';
import { viewerbaseDisplaySetReconstructable, viewerbaseGetDisplaySet } from './utils/viewerbaseDisplaySet.js';
import ViewerbaseDragDropContext from './utils/viewerbaseDragDropContext.js';
import ExpandableToolMenu from './viewer/ExpandableToolMenu.js';
import PlayClipButton from './viewer/PlayClipButton.js';
import Toolbar from './viewer/Toolbar.js';
import ToolbarButton from './viewer/ToolbarButton.js';
import {
  AboutContent,
  Checkbox,
  CineDialog,
  ContextMenu,
  CustomSelect,
  ErrorPage,
  HotkeyField,
  InputDialog,
  LanguageSwitcher,
  LayoutButton,
  LayoutChooser,
  MeasurementTable,
  MeasurementTableItem,
  OHIFModal,
  Overlay,
  OverlayTrigger,
  PageToolbar,
  QuickSwitch,
  RoundedButtonGroup,
  SelectTree,
  SimpleDialog,
  SimpleViewerDialog,
  SimpleDialogShell,
  EditDescriptionDialog,
  SaveDicomSeriesDialog,
  StudyBrowser,
  StudyList,
  TabComponents,
  TabFooter,
  TableList,
  TableListItem,
  TablePagination,
  TableSearchFilter,
  Thumbnail,
  ToolbarSection,
  Tooltip,
  ViewportDownloadForm,

  // Viewer workflow components
  LabellingFlow,
  SeriesTagLabellingFlow,
  DistortionFilterFlow,
} from './components';
import {
  DialogProvider,
  LoggerProvider,
  ModalConsumer,
  ModalProvider,
  useDialog,
  useLogger,
  useModal,
  withDialog,
  withLogger,
  withModal,
} from './contextProviders';
// Elements
import {
  DropdownMenu as Dropdown,
  Icon,
  ICONS,
  Label,
  OldSelect,
  Range,
  Select,
  TextArea,
  TextInput,
} from './elements';
import { useDebounce, useMedia } from './hooks';


const eventTypes = {
  sidebar: {
    toggle: 'ohif:ui:side-bar:toggle',
  },
  viewport: {
    update: 'ohif:ui:viewport:update',
  },
};


const TOOLBAR_BUTTON_TYPES = {
  COMMAND: 'command',
  SET_TOOL_ACTIVE: 'setToolActive',
  BUILT_IN: 'builtIn',
};


const TOOLBAR_BUTTON_BEHAVIORS = {
  CINE: 'CINE',
  DOWNLOAD_SCREEN_SHOT: 'DOWNLOAD_SCREEN_SHOT',
};


const workflow = {
  
  // Components which can be used to help create and interface with workflows
  LabellingFlow,
  SeriesTagLabellingFlow,
  DistortionFilterFlow,
}


export {

  // Dialogs
  SimpleViewerDialog,
  SimpleDialogShell,
  
  // Elements
  ICONS,
  Checkbox,
  Dropdown,
  Label,
  TextArea,
  TextInput,
  CineDialog,
  ContextMenu,
  ViewportDownloadForm,
  ExpandableToolMenu,
  Icon,
  LayoutButton,
  LayoutChooser,
  MeasurementTable,
  MeasurementTableItem,
  Overlay,
  OverlayTrigger,
  PlayClipButton,
  PageToolbar,
  QuickSwitch,
  Range,
  RoundedButtonGroup,
  ScrollableArea,
  Select,
  OldSelect,
  SelectTree,
  SimpleDialog,
  SaveDicomSeriesDialog,
  InputDialog,
  StudyBrowser,
  StudyList,
  TableList,
  TableListItem,
  Thumbnail,
  TabComponents,
  TabFooter,
  HotkeyField,
  LanguageSwitcher,
  TableSearchFilter,
  TablePagination,
  Toolbar,
  ToolbarButton,
  ToolbarSection,
  Tooltip,
  CustomSelect,
  AboutContent,
  ModalProvider,
  useModal,
  ModalConsumer,
  withModal,
  OHIFModal,
  DialogProvider,
  withDialog,
  useDialog,
  ErrorPage,
  LoggerProvider,
  withLogger,
  useLogger,

  // Hooks
  useDebounce,
  useMedia,

  // Utils
  ViewerbaseDragDropContext,
  viewerbaseGetDisplaySet,
  viewerbaseDisplaySetReconstructable,
  setLayoutAndViewportData,
  setMultiPanelLayout,

  // Constants
  TOOLBAR_BUTTON_TYPES,
  TOOLBAR_BUTTON_BEHAVIORS,

  // Events
  eventTypes,

  // Workflows
  workflow,
};
