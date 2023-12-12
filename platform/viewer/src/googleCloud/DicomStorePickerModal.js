import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { servicesManager } from '../App';

import * as GoogleCloudUtilServers from './utils/getServers';
import DatasetSelector from './DatasetSelector';

import './googleCloud.css';

function DicomStorePickerModal({ isOpen = false, setServers, onClose, user, url }) {
  const { t } = useTranslation('Common');

  const { UIModalService } = servicesManager.services;

  const showDicomStorePickerModal = () => {
    const handleEvent = (data) => {
      const servers = GoogleCloudUtilServers.getServers(data, data.dicomstore);
      setServers(servers);

      // Force auto close
      UIModalService.hide();
      onClose();
    };

    if (UIModalService) {
      UIModalService.show({
        content: DatasetSelector,
        title: t('Google Cloud Healthcare API'),
        contentProps: {
          setServers: handleEvent,
          user,
          url,
        },
        onClose,
      });
    }
  };

  return <>{isOpen && showDicomStorePickerModal()}</>;
}

DicomStorePickerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  setServers: PropTypes.func.isRequired,
  onClose: PropTypes.func,
  user: PropTypes.object.isRequired,
  url: PropTypes.string,
};

export default DicomStorePickerModal;
