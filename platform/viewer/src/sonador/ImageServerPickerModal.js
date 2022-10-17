import React from 'react';
import PropTypes from 'prop-types';

import { withTranslation } from 'react-i18next';

import { servicesManager } from '../App.js';

import ConnectedImageServerDatasetSelector from './ConnectedImageServerDatasetSelector.js';

function ImageServerPickerModal({
  isOpen = false,
  onClose,
  user,
  onServerChange,
  t,
}) {
  const { UIModalService } = servicesManager.services;

  const showImageServerPickerModal = () => {
    // Show the Sonador image server modal

    const handleEvent = () => {
      // Set servers and hide modal

      UIModalService.hide();
      onClose();
    };

    if (UIModalService) {
      UIModalService.show({
        content: ConnectedImageServerDatasetSelector,
        title: t('Select Sonador Image Server'),
        contentProps: { user, onServerChange },
        onClose,
      });
    }
  };

  return (
    <React.Fragment>{isOpen && showImageServerPickerModal()}</React.Fragment>
  );
}

ImageServerPickerModal.propTypes = {
  // Required components and properties for image server picker modal
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  onServerChange: PropTypes.func,
  user: PropTypes.object.isRequired,
};

export default withTranslation('Common')(ImageServerPickerModal);
