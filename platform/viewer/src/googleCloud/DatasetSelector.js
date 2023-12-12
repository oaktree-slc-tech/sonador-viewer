import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import GoogleCloudApi from './api/GoogleCloudApi';
import DatasetPicker from './DatasetPicker';
import DicomStorePicker from './DicomStorePicker';
import LocationPicker from './LocationPicker';
import ProjectPicker from './ProjectPicker';

import './googleCloud.css';

const DatasetSelector = ({ user, setServers }) => {
  const { t } = useTranslation('Common');

  const [project, setProject] = useState(null);
  const [location, setLocation] = useState(null);
  const [dataset, setDataset] = useState(null);

  const onProjectSelect = (project) => {
    setProject(project);
  };

  const onLocationSelect = (location) => {
    setLocation(location);
  };

  const onDatasetSelect = (dataset) => {
    setDataset(dataset);
  };

  const onProjectClick = () => {
    setDataset(null);
    setLocation(null);
    setProject(null);
  };

  const onLocationClick = () => {
    setDataset(null);
    setLocation(null);
  };

  const onDatasetClick = () => {
    setDataset(null);
  };

  const onDicomStoreSelect = (dicomStoreJson) => {
    const dicomStore = dicomStoreJson.name;
    const parts = dicomStore.split('/');
    const result = {
      wadoUriRoot: GoogleCloudApi.urlBase + `/${dicomStore}/dicomWeb`,
      qidoRoot: GoogleCloudApi.urlBase + `/${dicomStore}/dicomWeb`,
      wadoRoot: GoogleCloudApi.urlBase + `/${dicomStore}/dicomWeb`,
      project: parts[1],
      location: parts[3],
      dataset: parts[5],
      dicomStore: parts[7],
    };
    setServers(result);
  };

  let projectBreadcrumbs = (
    <div className="gcp-picker--path">
      <span>{t('Select a Project')}</span>
    </div>
  );

  if (project) {
    projectBreadcrumbs = (
      <div className="gcp-picker--path">
        <span onClick={onProjectClick}>{project.name}</span>
        {project && location && <span onClick={onLocationClick}> -> {location.name.split('/')[3]}</span>}
        {project && location && dataset && <span onClick={onDatasetClick}> -> {dataset.name.split('/')[5]}</span>}
      </div>
    );
  }

  return (
    <>
      {projectBreadcrumbs}
      {!project && <ProjectPicker accessToken={user.access_token} onSelect={onProjectSelect} />}

      {project && !location && (
        <LocationPicker accessToken={user.access_token} project={project} onSelect={onLocationSelect} />
      )}
      {project && location && !dataset && (
        <DatasetPicker
          accessToken={user.access_token}
          project={project}
          location={location}
          onSelect={onDatasetSelect}
        />
      )}
      {project && location && dataset && (
        <DicomStorePicker accessToken={user.access_token} dataset={dataset} onSelect={onDicomStoreSelect} />
      )}
    </>
  );
};

DatasetSelector.propTypes = {
  user: PropTypes.object.isRequired,
  setServers: PropTypes.func.isRequired,
};

export default DatasetSelector;
