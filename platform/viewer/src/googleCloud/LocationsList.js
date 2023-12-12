import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Icon } from '@ohif/ui';

import './googleCloud.css';

const LocationsList = ({ locations, loading = true, filter, error, onSelect }) => {
  const { t } = useTranslation('Common');

  const [highlightedItem, setHighlightedItem] = useState(null);

  const renderTableRow = (location) => {
    return (
      <tr
        key={location.locationId}
        className={highlightedItem === location.locationId ? 'noselect active' : 'noselect'}
        onMouseEnter={() => {
          onHighlightItem(location.locationId);
        }}
        onClick={() => {
          onSelect(location);
        }}
      >
        <td>{location.name.split('/')[3]}</td>
      </tr>
    );
  };

  const onHighlightItem = (locationId) => {
    setHighlightedItem(locationId);
  };

  if (error) {
    return <p>{error}</p>;
  }

  const loadingIcon = <Icon name="circle-notch" className="loading-icon-spin loading-icon" />;

  if (loading) {
    return loadingIcon;
  }

  const body = (
    <tbody id="LocationList">
      {locations
        .filter((location) => location.name.split('/')[3].toLowerCase().includes(filter.toLowerCase()) || filter === '')
        .map(renderTableRow)}
    </tbody>
  );

  return (
    <table id="tblLocationList" className="gcp-table table noselect">
      <thead>
        <tr>
          <th>{t('Location')}</th>
        </tr>
      </thead>
      {locations && body}
    </table>
  );
};

LocationsList.propTypes = {
  locations: PropTypes.array,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onSelect: PropTypes.func,
};

export default LocationsList;
