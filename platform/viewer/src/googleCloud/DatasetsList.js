import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Icon } from '@ohif/ui';

import './googleCloud.css';

const DatasetsList = ({ datasets, loading = true, error, onSelect }) => {
  const { t } = useTranslation('Common');

  const [highlightedItem, setHighlightedItem] = useState('');

  const onHighlightItem = (dataset) => {
    setHighlightedItem(dataset);
  };

  if (error) {
    return <p>{error}</p>;
  }

  if (loading) {
    return <Icon name="circle-notch" className="loading-icon-spin loading-icon" />;
  }

  return (
    <table id="tblDatasetList" className="gcp-table table noselect">
      <thead>
        <tr>
          <th>{t('Dataset')}</th>
        </tr>
      </thead>
      {datasets && (
        <tbody id="DatasetList">
          {datasets.map((dataset) => (
            <tr
              key={dataset.name}
              className={highlightedItem === dataset.name ? 'noselect active' : 'noselect'}
              onMouseEnter={() => onHighlightItem(dataset.name)}
              onClick={() => onSelect(dataset)}
            >
              <td>{dataset.name.split('/')[5]}</td>
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
};

DatasetsList.propTypes = {
  datasets: PropTypes.array,
  loading: PropTypes.bool,
  error: PropTypes.string,
  onSelect: PropTypes.func,
};

export default DatasetsList;
