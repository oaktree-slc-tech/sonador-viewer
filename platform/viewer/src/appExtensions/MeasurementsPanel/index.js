import React, { useEffect, useState } from 'react';

import OHIF, { measurements } from '@ohif/core';
import { workflow } from '@ohif/ui';

import SonadorMeasurementTable from './SonadorMeasurementsTable.js';
import init from './init.js';

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id: 'measurements-table',
  get version() {
    return window.version;
  },

  preRegistration({ servicesManager, commandsManager, configuration = {} }) {
    init({ servicesManager, commandsManager, configuration });
  },

  getPanelModule({ servicesManager, commandsManager }) {
    // Retrieve Measurements Panel module

    const { UINotificationService, UIDialogService } = servicesManager.services;

    const showLabellingDialog = (props, measurementData) => {
      // Create a dialog which can be used to label data
      const dialogProps = props;

      commandsManager.runCommand('labellingDialog', { measurementData, dialogProps });
    };

    const onRelabel = (tool) => {
      // Show labelling workflow dialog with edit location and edit description buttons
      
      return showLabellingDialog({ editLocation: true, skipAddLabelButton: true }, tool);
    }

    const onEditDescription = (tool) => {
      // Show labelling workflow dialog with edit descrpition only
      
      return showLabellingDialog({ editDescriptionOnDialog: true }, tool);
    }

    const ExtendedConnectedMeasurementTable = () => (
      <SonadorMeasurementTable
        servicesManager={servicesManager}
        onRelabel={onRelabel} onEditDescription={onEditDescription}
        onSaveComplete={(message) => {
          if (UINotificationService) {
            UINotificationService.show(message);
          }
        }}
      />
    );
    return {
      menuOptions: [
        {
          icon: 'list',
          label: 'Measurements',
          target: 'measurement-panel',
        },
      ],
      components: [
        {
          id: 'measurement-panel',
          component: ExtendedConnectedMeasurementTable,
        },
      ],
      defaultContext: ['VIEWER'],
    };
  },
};
