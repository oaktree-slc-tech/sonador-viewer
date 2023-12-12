import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import api from './api/GoogleCloudApi';
import DicomStoreList from './DicomStoreList';

import './googleCloud.css';

const DicomStorePicker = ({ dataset, onSelect, accessToken }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState([]);
  const [filterStr, setFilterStr] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        api.setAccessToken(accessToken);
        const response = await api.loadDicomStores(dataset.name);

        if (response.isError) {
          setError(response.message);
        } else {
          setStores(response.data.dicomStores || []);
        }

        setLoading(false);
      } catch (error) {
        setError(error.message);
        setLoading(false);
      }
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
      <DicomStoreList stores={stores} loading={loading} error={error} filter={filterStr} onSelect={onSelect} />
    </div>
  );
};

DicomStorePicker.propTypes = {
  dataset: PropTypes.object,
  onSelect: PropTypes.func,
  accessToken: PropTypes.string.isRequired,
};

export default DicomStorePicker;
