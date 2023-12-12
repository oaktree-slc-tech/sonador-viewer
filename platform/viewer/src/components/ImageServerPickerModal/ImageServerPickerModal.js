import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { servicesManager } from '../../App';
import ConnectedImageServerDatasetSelector from '../ConnectedImageServerDatasetSelector';

const { UIModalService } = servicesManager.services;

function ImageServerPickerModal({ isOpen = false, onClose, user, onServerChange }) {
  const { t } = useTranslation('Common');

  const showImageServerPickerModal = () => {
    if (UIModalService) {
      UIModalService.show({
        content: ConnectedImageServerDatasetSelector,
        title: t('Select Sonador Image Server'),
        contentProps: { user, onServerChange },
        onClose,
      });
    }
  };

  return <>{isOpen && showImageServerPickerModal()}</>;
}

ImageServerPickerModal.propTypes = {
  // Required components and properties for image server picker modal
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  onServerChange: PropTypes.func,
  user: PropTypes.object.isRequired,
};

export default ImageServerPickerModal;
