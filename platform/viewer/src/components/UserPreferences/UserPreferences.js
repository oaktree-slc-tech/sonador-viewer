import React from 'react';
import PropTypes from 'prop-types';

import { TabComponents } from '@ohif/ui';

import ViewerMetadataSettings from '../../connectedComponents/ViewerMetadataSettings/ViewerMetadataSettings';

import { GeneralPreferences } from './GeneralPreferences';
// Tabs
import { HotkeysPreferences } from './HotkeysPreferences';
import { WindowLevelPreferences } from './WindowLevelPreferences';

import './UserPreferences.styl';

// Fourth tab (sonador#42 FR-11): the viewer-metadata corner settings reuse the existing
// component in tab mode. It carries its own Save/Cancel actions, so the modal's onClose
// customProp is not passed through.
const ViewerMetadataPreferences = () => <ViewerMetadataSettings asTab withHeader />;

const tabs = [
  {
    name: 'Hotkeys',
    Component: HotkeysPreferences,
    customProps: {},
  },
  {
    name: 'General',
    Component: GeneralPreferences,
    customProps: {},
  },
  {
    name: 'Window Level',
    Component: WindowLevelPreferences,
    customProps: {},
  },
  {
    name: 'Viewer Metadata',
    Component: ViewerMetadataPreferences,
    customProps: {},
  },
];

function UserPreferences({ hide }) {
  const customProps = {
    onClose: hide,
  };
  return <TabComponents tabs={tabs} customProps={customProps} />;
}

UserPreferences.propTypes = {
  hide: PropTypes.func,
};

export { UserPreferences };
