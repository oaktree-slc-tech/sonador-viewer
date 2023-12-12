import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Icon } from '@ohif/ui';

import './googleCloud.css';

const ProjectsList = ({ projects, loading = true, filter, error, onSelect }) => {
  const { t } = useTranslation('Common');

  const [highlightedItem, setHighlightedItem] = useState(null);

  const renderTableRow = (project) => {
    return (
      <tr
        key={project.projectId}
        className={highlightedItem === project.projectId ? 'noselect active' : 'noselect'}
        onMouseEnter={() => {
          onHighlightItem(project.projectId);
        }}
        onClick={() => {
          onHighlightItem(project.projectId);
          onSelect(project);
        }}
      >
        <td>{project.name}</td>
        <td>{project.projectId}</td>
      </tr>
    );
  };

  const onHighlightItem = (projectId) => {
    setHighlightedItem(projectId);
  };

  if (error) {
    return <p>{error}</p>;
  }

  const loadingIcon = <Icon name="circle-notch" className="loading-icon-spin loading-icon" />;

  if (loading) {
    return loadingIcon;
  }

  const lowerCaseFilter = filter.toLowerCase();
  const filteredProjects = projects.filter(
    (project) =>
      typeof project.name === 'string' && (filter === '' || project.name.toLowerCase().includes(lowerCaseFilter))
  );

  const body = <tbody id="ProjectList">{filteredProjects.map(renderTableRow)}</tbody>;

  return (
    <table id="tblProjectList" className="gcp-table table noselect">
      <thead>
        <tr>
          <th>{t('Project')}</th>
          <th>{t('ID')}</th>
        </tr>
      </thead>
      {projects && body}
    </table>
  );
};

ProjectsList.propTypes = {
  projects: PropTypes.array,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
};

export default ProjectsList;
