import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import api from './api/GoogleCloudApi';
import DatasetsList from './DatasetsList';

import './googleCloud.css';

const DatasetPicker = ({ project, location, onSelect, accessToken }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [filterStr, setFilterStr] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      api.setAccessToken(accessToken);

      const response = await api.loadDatasets(project.projectId, location.locationId);

      if (response.isError) {
        setError(response.message);
        return;
      }

      setDatasets(response.data.datasets || []);
      setLoading(false);
    };

    fetchData();
  }, []);

  return (
    <div>
      <input
        className="form-control gcp-input"
        type="text"
        value={filterStr}
        onChange={(e) => setFilterStr(e.target.value)}
      />
      <DatasetsList datasets={datasets} loading={loading} error={error} filter={filterStr} onSelect={onSelect} />
    </div>
  );
};

DatasetPicker.propTypes = {
  project: PropTypes.object,
  location: PropTypes.object,
  onSelect: PropTypes.func,
  accessToken: PropTypes.string,
};

export default DatasetPicker;
