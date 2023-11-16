import { ScrollableArea } from './ScrollableArea/ScrollableArea.js';
import { asyncComponent, retryImport } from './utils/asyncComponent';
import setLayoutAndViewportData from './utils/setLayoutAndViewportData.js';
import setMultiPanelLayout from './utils/setMultiPanelLayout.js';
import { viewerbaseDisplaySetReconstructable, viewerbaseGetDisplaySet } from './utils/viewerbaseDisplaySet.js';
import ViewerbaseDragDropContext from './utils/viewerbaseDragDropContext.js';
// Alias this for now as not all dependents are using strict versioning
import ExpandableToolMenu from './viewer/ExpandableToolMenu.js';
import PlayClipButton from './viewer/PlayClipButton.js';
import Toolbar from './viewer/Toolbar.js';
import ToolbarButton from './viewer/ToolbarButton.js';
import {
  AboutContent,
  Checkbox,
  CineDialog,
  ContextMenu,
  ErrorPage,
  HotkeyField,
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
} from './components';
import {
  DialogProvider,
  LoggerProvider,
  ModalConsumer,
  ModalProvider,
  SnackbarProvider,
  useDialog,
  useLogger,
  useModal,
  useSnackbarContext,
  withDialog,
  withLogger,
  withModal,
  withSnackbar,
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

export {
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
  AboutContent,
  SnackbarProvider,
  useSnackbarContext,
  withSnackbar,
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
  asyncComponent,
  retryImport,
  viewerbaseGetDisplaySet,
  viewerbaseDisplaySetReconstructable,
  setLayoutAndViewportData,
  setMultiPanelLayout,

  // Constants
  TOOLBAR_BUTTON_TYPES,
  TOOLBAR_BUTTON_BEHAVIORS,

  // Events
  eventTypes,
};
