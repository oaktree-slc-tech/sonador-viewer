import React, { useState } from 'react';
import Dropzone from 'react-dropzone';
import { useTranslation } from 'react-i18next';

import { metadata, utils } from '@ohif/core';

import { extensionManager } from '../App';
import filesToStudies from '../lib/filesToStudies';

import Viewer from './Viewer';

import './ViewerLocalFileData.css';

const { OHIFStudyMetadata } = metadata;
const { studyMetadataManager } = utils;

const dropZoneLinkDialog = (onDrop, t, dir) => {
  return (
    <Dropzone onDrop={onDrop} noDrag>
      {({ getRootProps, getInputProps }) => (
        <span {...getRootProps()} className="link-dialog">
          {dir ? (
            <span>
              {t('Load folders')}
              <input {...getInputProps()} webkitdirectory="true" mozdirectory="true" />
            </span>
          ) : (
            <span>
              {t('Load files')}
              <input {...getInputProps()} />
            </span>
          )}
        </span>
      )}
    </Dropzone>
  );
};

const linksDialogMessage = (onDrop, t) => {
  return (
    <>
      {t('Or click to ')}
      {dropZoneLinkDialog(onDrop, t)}
      {t(' or ')}
      {dropZoneLinkDialog(onDrop, t, true)}
      {t(' from dialog')}
    </>
  );
};

function ViewerLocalFileData() {
  const { t } = useTranslation('Common');

  const [studies, setStudies] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const updateStudies = (studies) => {
    studyMetadataManager.purge();

    const updatedStudies = studies.map((study) => {
      const studyMetadata = new OHIFStudyMetadata(study, study.StudyInstanceUID);
      const sopClassHandlerModules = extensionManager.modules['sopClassHandlerModule'];

      study.displaySets = study.displaySets || studyMetadata.createDisplaySets(sopClassHandlerModules);

      studyMetadata.forEachDisplaySet((displayset) => {
        displayset.localFile = true;
      });

      studyMetadataManager.add(studyMetadata);

      return study;
    });

    setStudies(updatedStudies);
  };

  const onDrop = async (acceptedFiles) => {
    setLoading(true);

    try {
      const studies = await filesToStudies(acceptedFiles);
      updateStudies(studies);
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return <div>Error: {JSON.stringify(error)}</div>;
  }

  return (
    <Dropzone onDrop={onDrop} noClick>
      {({ getRootProps }) => (
        <div {...getRootProps()} style={{ width: '100%', height: '100%' }}>
          {studies ? (
            <Viewer studies={studies} studyInstanceUIDs={studies.map((a) => a.StudyInstanceUID)} />
          ) : (
            <div className={'drag-drop-instructions'}>
              <div className={'drag-drop-contents'}>
                {loading ? (
                  <h3>{t('Loading...')}</h3>
                ) : (
                  <>
                    <h3>{t('Drag and Drop DICOM files here to load them in the Viewer')}</h3>
                    <h4>{linksDialogMessage(onDrop, t)}</h4>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Dropzone>
  );
}

export default ViewerLocalFileData;
