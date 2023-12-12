import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import api from './api/GoogleCloudApi';
import ProjectsList from './ProjectsList';

import './googleCloud.css';

const ProjectPicker = ({ onSelect, accessToken }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [filterStr, setFilterStr] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      api.setAccessToken(accessToken);
      const response = await api.loadProjects();

      if (response.isError) {
        setError(response.message);
        return;
      }

      setProjects(response.data.projects || []);
      setLoading(false);
      setFilterStr('');
    };

    void fetchData();
  }, []);

  return (
    <div>
      <input
        className="form-control gcp-input"
        type="text"
        value={filterStr}
        onChange={(e) => setFilterStr(e.target.value)}
      />
      <ProjectsList projects={projects} loading={loading} filter={filterStr} error={error} onSelect={onSelect} />
    </div>
  );
};

ProjectPicker.propTypes = {
  onSelect: PropTypes.func,
  accessToken: PropTypes.string,
};

export default ProjectPicker;
