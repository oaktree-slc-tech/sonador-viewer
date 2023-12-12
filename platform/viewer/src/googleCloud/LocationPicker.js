import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import api from './api/GoogleCloudApi';
import LocationsList from './LocationsList';

import './googleCloud.css';

function LocationPicker({ project, onSelect, accessToken }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [filterStr, setFilterStr] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      api.setAccessToken(accessToken);

      const response = await api.loadLocations(project.projectId);

      if (response.isError) {
        setError(response.message);
      } else {
        setLocations(response.data.locations || []);
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
      <LocationsList locations={locations} loading={loading} error={error} filter={filterStr} onSelect={onSelect} />
    </div>
  );
}

LocationPicker.propTypes = {
  project: PropTypes.object,
  onSelect: PropTypes.func,
  accessToken: PropTypes.string,
};

export default LocationPicker;
