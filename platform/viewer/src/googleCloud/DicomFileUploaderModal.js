import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { servicesManager } from '../App';

import DicomUploader from './DicomUploader';

function DicomFileUploaderModal({ isOpen = false, onClose, url, retrieveAuthHeaderFunction }) {
  const { t } = useTranslation('Common');

  const { UIModalService } = servicesManager.services;

  const showDicomStorePickerModal = () => {
    if (!UIModalService) {
      return;
    }

    UIModalService.show({
      content: DicomUploader,
      title: t('Upload DICOM Files'),
      contentProps: {
        url,
        retrieveAuthHeaderFunction,
      },
      onClose,
    });
  };

  return <>{isOpen && showDicomStorePickerModal()}</>;
}

DicomFileUploaderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  retrieveAuthHeaderFunction: PropTypes.func.isRequired,
  onClose: PropTypes.func,
  url: PropTypes.string,
};

export default DicomFileUploaderModal;
