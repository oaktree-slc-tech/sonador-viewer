import React, { Fragment } from 'react';
import { withTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { servicesManager } from '../App';
import DicomUploader from './DicomUploader';

function DicomFileUploaderModal({ isOpen = false, onClose, url, retrieveAuthHeaderFunction, t }) {
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

  return <Fragment>{isOpen && showDicomStorePickerModal()}</Fragment>;
}

DicomFileUploaderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  retrieveAuthHeaderFunction: PropTypes.func.isRequired,
  onClose: PropTypes.func,
  url: PropTypes.string,
};

export default withTranslation('Common')(DicomFileUploaderModal);
